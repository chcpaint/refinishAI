import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Super Admin only — AI Activity Log API
// Provides transparency reporting on all engine calculations, fallbacks, and LLM usage

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify super_admin role
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — super_admin only' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const periodDays = parseInt(searchParams.get('periodDays') || '30', 10)
    const companyFilter = searchParams.get('companyId') || null
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10)

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - periodDays)
    const startStr = startDate.toISOString()

    // Summary stats — aggregated counts by activity_type
    const { data: typeCounts } = await supabase
      .from('ai_activity_log')
      .select('activity_type')
      .gte('created_at', startStr)

    // Summary stats — aggregated counts by computation_type
    const { data: compCounts } = await supabase
      .from('ai_activity_log')
      .select('computation_type')
      .gte('created_at', startStr)

    // Summary stats — aggregated counts by method
    const { data: methodCounts } = await supabase
      .from('ai_activity_log')
      .select('method')
      .gte('created_at', startStr)

    // LLM usage details
    const { data: llmLogs } = await supabase
      .from('ai_activity_log')
      .select('llm_provider, llm_model, llm_prompt_tokens, llm_completion_tokens, llm_total_tokens, llm_latency_ms, llm_cost_usd, created_at, method, result_summary')
      .in('computation_type', ['llm_assisted', 'hybrid'])
      .gte('created_at', startStr)
      .order('created_at', { ascending: false })

    // Recent activity log (paginated)
    let recentQuery = supabase
      .from('ai_activity_log')
      .select(`
        id, company_id, activity_type, method, computation_type,
        input_invoice_count, input_consumption_count, input_product_count,
        data_period_days, confidence_score,
        llm_provider, llm_model, llm_total_tokens, llm_latency_ms, llm_cost_usd,
        result_status, result_summary, error_message,
        execution_time_ms, created_at
      `)
      .gte('created_at', startStr)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    if (companyFilter) {
      recentQuery = recentQuery.eq('company_id', companyFilter)
    }

    const { data: recentLogs, count: totalCount } = await recentQuery

    // Get company names for display (anonymized IDs to names)
    const companyIds = [...new Set((recentLogs || []).map(l => l.company_id).filter(Boolean))]
    const { data: companies } = await supabase
      .from('companies')
      .select('id, name')
      .in('id', companyIds)

    const companyMap = new Map((companies || []).map(c => [c.id, c.name]))

    // Build aggregation summaries
    const byActivityType: Record<string, number> = {}
    for (const row of typeCounts || []) {
      byActivityType[row.activity_type] = (byActivityType[row.activity_type] || 0) + 1
    }

    const byComputationType: Record<string, number> = {}
    for (const row of compCounts || []) {
      byComputationType[row.computation_type] = (byComputationType[row.computation_type] || 0) + 1
    }

    const byMethod: Record<string, number> = {}
    for (const row of methodCounts || []) {
      byMethod[row.method] = (byMethod[row.method] || 0) + 1
    }

    // LLM usage summary
    const llmSummary = {
      totalCalls: (llmLogs || []).length,
      totalTokens: (llmLogs || []).reduce((s, l) => s + (l.llm_total_tokens || 0), 0),
      totalCostUsd: (llmLogs || []).reduce((s, l) => s + (l.llm_cost_usd || 0), 0),
      avgLatencyMs: (llmLogs || []).length > 0
        ? Math.round((llmLogs || []).reduce((s, l) => s + (l.llm_latency_ms || 0), 0) / (llmLogs || []).length)
        : 0,
      byProvider: {} as Record<string, { calls: number; tokens: number; cost: number }>,
      byModel: {} as Record<string, { calls: number; tokens: number; cost: number }>,
      recentCalls: (llmLogs || []).slice(0, 20)
    }

    for (const l of llmLogs || []) {
      if (l.llm_provider) {
        const p = llmSummary.byProvider[l.llm_provider] || { calls: 0, tokens: 0, cost: 0 }
        p.calls++
        p.tokens += l.llm_total_tokens || 0
        p.cost += l.llm_cost_usd || 0
        llmSummary.byProvider[l.llm_provider] = p
      }
      if (l.llm_model) {
        const m = llmSummary.byModel[l.llm_model] || { calls: 0, tokens: 0, cost: 0 }
        m.calls++
        m.tokens += l.llm_total_tokens || 0
        m.cost += l.llm_cost_usd || 0
        llmSummary.byModel[l.llm_model] = m
      }
    }

    // Performance summary
    const allLogs = typeCounts || []
    const totalActivities = allLogs.length

    return NextResponse.json({
      summary: {
        totalActivities,
        periodDays,
        byActivityType,
        byComputationType,
        byMethod,
        baseCalculationRate: totalActivities > 0
          ? Math.round(((byActivityType['base_calculation'] || 0) / totalActivities) * 1000) / 10
          : 0,
        insufficientDataRate: totalActivities > 0
          ? Math.round(((byActivityType['insufficient_data'] || 0) / totalActivities) * 1000) / 10
          : 0,
        llmUsageRate: totalActivities > 0
          ? Math.round((((byComputationType['llm_assisted'] || 0) + (byComputationType['hybrid'] || 0)) / totalActivities) * 1000) / 10
          : 0,
        errorRate: totalActivities > 0
          ? Math.round(((byActivityType['error'] || 0) / totalActivities) * 1000) / 10
          : 0,
      },
      llm: llmSummary,
      recentLogs: (recentLogs || []).map(l => ({
        ...l,
        company_name: companyMap.get(l.company_id) || 'Unknown'
      })),
      pagination: {
        page,
        pageSize,
        total: totalCount || totalActivities
      },
      generatedAt: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('Activity API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
