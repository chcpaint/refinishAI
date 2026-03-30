import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Super Admin — Audit Export API
// Generates a detailed transparency report for a specific company
// showing every calculation, the exact data used, and full methodology

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — super_admin only' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const companyId = searchParams.get('companyId')
    const periodDays = parseInt(searchParams.get('periodDays') || '90', 10)

    if (!companyId) {
      return NextResponse.json({ error: 'companyId is required' }, { status: 400 })
    }

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - periodDays)
    const startStr = startDate.toISOString().split('T')[0]

    // 1. Company info
    const { data: company } = await supabase
      .from('companies')
      .select('id, name, city, state, zip, created_at')
      .eq('id', companyId)
      .single()

    if (!company) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // 2. All invoices used in the period
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, total_amount, material_cost, labor_cost, parts_count, status, completion_date, vehicle_info, insurance_company')
      .eq('company_id', companyId)
      .gte('invoice_date', startStr)
      .order('invoice_date', { ascending: false })

    // 3. All estimates in period
    const { data: estimates } = await supabase
      .from('estimates')
      .select('id, estimate_number, estimate_date, total_amount, status, vehicle_info, insurance_company, source')
      .eq('company_id', companyId)
      .gte('estimate_date', startStr)
      .order('estimate_date', { ascending: false })

    // 4. Consumption records tied to these invoices
    const invoiceIds = (invoices || []).map(i => i.id)
    let consumption: any[] = []
    if (invoiceIds.length > 0) {
      // Batch fetch in chunks of 50 to avoid query limits
      for (let i = 0; i < invoiceIds.length; i += 50) {
        const chunk = invoiceIds.slice(i, i + 50)
        const { data } = await supabase
          .from('consumption_history')
          .select('id, invoice_id, product_id, estimated_quantity, actual_quantity, variance_pct, completion_date')
          .in('invoice_id', chunk)
        if (data) consumption.push(...data)
      }
    }

    // 5. Products used
    const { data: products } = await supabase
      .from('products')
      .select('id, name, sku, category, unit_cost, unit_of_measure')
      .eq('company_id', companyId)

    // 6. Reorder recommendations — products at or below reorder point
    //    These are driven by consumption patterns from estimates & invoices
    const { data: inventoryStock } = await supabase
      .from('inventory_stock')
      .select('product_id, quantity, reorder_point, par_level, shop_id')
      .eq('shop_id', companyId)

    // Calculate avg daily usage from consumption over the period
    const productUsage = new Map<string, { total: number; days: number }>()
    for (const c of consumption) {
      const qty = c.actual_quantity || 0
      const pid = c.product_id
      const existing = productUsage.get(pid) || { total: 0, days: periodDays }
      existing.total += qty
      productUsage.set(pid, existing)
    }

    const reorderRecommendations: any[] = []
    for (const stock of inventoryStock || []) {
      const product = (products || []).find(p => p.id === stock.product_id)
      if (!product) continue

      const usage = productUsage.get(stock.product_id)
      const avgDailyUsage = usage ? usage.total / periodDays : 0
      const daysRemaining = avgDailyUsage > 0 ? Math.floor(stock.quantity / avgDailyUsage) : 999
      const reorderPoint = stock.reorder_point || 0
      const parLevel = stock.par_level || 0
      const suggestedQty = Math.max(0, parLevel - stock.quantity)

      // Only include items at or below reorder point, or with < 7 days stock
      if (stock.quantity <= reorderPoint || daysRemaining <= 7) {
        reorderRecommendations.push({
          productId: stock.product_id,
          productName: product.name,
          sku: product.sku,
          category: product.category,
          currentStock: stock.quantity,
          reorderPoint,
          parLevel,
          suggestedOrderQty: suggestedQty,
          unitCost: product.unit_cost,
          extendedCost: Math.round(suggestedQty * (product.unit_cost || 0) * 100) / 100,
          avgDailyUsage: Math.round(avgDailyUsage * 1000) / 1000,
          daysOfStockRemaining: daysRemaining,
          priority: daysRemaining <= 3 ? 'critical' : daysRemaining <= 7 ? 'urgent' : 'normal',
          formula: {
            avgDailyUsage: `${usage?.total || 0} total used / ${periodDays} days = ${(avgDailyUsage).toFixed(4)}/day`,
            reorderPoint: `Set at ${reorderPoint} units`,
            parLevel: `Set at ${parLevel} units`,
            suggestedQty: `Par Level (${parLevel}) - Current Stock (${stock.quantity}) = ${suggestedQty} units`,
            daysRemaining: avgDailyUsage > 0
              ? `${stock.quantity} units / ${avgDailyUsage.toFixed(4)}/day = ${daysRemaining} days`
              : 'No usage recorded — infinite days remaining'
          }
        })
      }
    }

    // Sort by priority (critical first) then days remaining
    reorderRecommendations.sort((a, b) => {
      const priOrder: Record<string, number> = { critical: 0, urgent: 1, normal: 2 }
      return (priOrder[a.priority] || 9) - (priOrder[b.priority] || 9) || a.daysOfStockRemaining - b.daysOfStockRemaining
    })

    // Upcoming estimates driving the reorder
    const upcomingEstimates = (estimates || []).filter(e =>
      ['Quoted', 'Approved', 'Scheduled'].includes(e.status)
    )

    // 7. Activity logs for this company
    const { data: activityLogs } = await supabase
      .from('ai_activity_log')
      .select('*')
      .eq('company_id', companyId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(200)

    // 7. Build computed summaries
    const productMap = new Map((products || []).map(p => [p.id, p]))

    // Invoice summary stats
    const invoiceStats = {
      count: (invoices || []).length,
      totalRevenue: (invoices || []).reduce((s, i) => s + (i.total_amount || 0), 0),
      avgInvoice: (invoices || []).length > 0
        ? (invoices || []).reduce((s, i) => s + (i.total_amount || 0), 0) / (invoices || []).length
        : 0,
      totalMaterial: (invoices || []).reduce((s, i) => s + (i.material_cost || 0), 0),
      totalLabor: (invoices || []).reduce((s, i) => s + (i.labor_cost || 0), 0),
    }

    // Consumption / waste summary
    let totalEstimated = 0
    let totalActual = 0
    const categoryWaste: Record<string, { expected: number; actual: number; records: number }> = {}

    for (const c of consumption) {
      const product = productMap.get(c.product_id)
      const cat = product?.category || 'Unknown'
      totalEstimated += c.estimated_quantity || 0
      totalActual += c.actual_quantity || 0
      if (!categoryWaste[cat]) categoryWaste[cat] = { expected: 0, actual: 0, records: 0 }
      categoryWaste[cat].expected += c.estimated_quantity || 0
      categoryWaste[cat].actual += c.actual_quantity || 0
      categoryWaste[cat].records++
    }

    const overallWaste = totalEstimated > 0
      ? ((totalActual - totalEstimated) / totalEstimated) * 100
      : 0

    // Activity log summary
    const activitySummary = {
      total: (activityLogs || []).length,
      byType: {} as Record<string, number>,
      byMethod: {} as Record<string, number>,
      byComputation: {} as Record<string, number>,
      avgExecutionMs: 0,
      errors: 0,
      rejections: 0,
    }

    let totalExecMs = 0
    let execCount = 0
    for (const log of activityLogs || []) {
      activitySummary.byType[log.activity_type] = (activitySummary.byType[log.activity_type] || 0) + 1
      activitySummary.byMethod[log.method] = (activitySummary.byMethod[log.method] || 0) + 1
      activitySummary.byComputation[log.computation_type] = (activitySummary.byComputation[log.computation_type] || 0) + 1
      if (log.result_status === 'failed') activitySummary.errors++
      if (log.result_status === 'rejected') activitySummary.rejections++
      if (log.execution_time_ms) { totalExecMs += log.execution_time_ms; execCount++ }
    }
    activitySummary.avgExecutionMs = execCount > 0 ? Math.round(totalExecMs / execCount) : 0

    // Confidence calculation breakdown
    const invCount = (invoices || []).length
    const consCount = consumption.length
    const confidenceFormula = {
      base: 20,
      invoiceComponent: Math.round(Math.min(invCount / 50, 1) * 40 * 100) / 100,
      consumptionComponent: Math.round(Math.min(consCount / 200, 1) * 40 * 100) / 100,
      total: Math.round((20 + Math.min(invCount / 50, 1) * 40 + Math.min(consCount / 200, 1) * 40) * 100) / 100,
      meetsProjectionThreshold: invCount >= 50 && consCount >= 100,
      invoiceThreshold: `${invCount} / 50 required`,
      consumptionThreshold: `${consCount} / 100 required`
    }

    return NextResponse.json({
      company,
      periodDays,
      reportDate: new Date().toISOString(),
      dataInputs: {
        invoices: (invoices || []).map(i => ({
          id: i.id,
          number: i.invoice_number,
          date: i.invoice_date,
          total: i.total_amount,
          material: i.material_cost,
          labor: i.labor_cost,
          parts: i.parts_count,
          status: i.status,
          vehicle: i.vehicle_info,
          insurance: i.insurance_company
        })),
        estimates: (estimates || []).map(e => ({
          id: e.id,
          number: e.estimate_number,
          date: e.estimate_date,
          total: e.total_amount,
          status: e.status,
          vehicle: e.vehicle_info,
          insurance: e.insurance_company,
          source: e.source
        })),
        consumptionRecords: consumption.length,
        products: (products || []).map(p => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          category: p.category,
          unitCost: p.unit_cost,
          unit: p.unit_of_measure
        }))
      },
      computedMetrics: {
        invoiceStats,
        wasteAnalysis: {
          totalEstimatedQuantity: Math.round(totalEstimated * 100) / 100,
          totalActualQuantity: Math.round(totalActual * 100) / 100,
          overallWastePercent: Math.round(overallWaste * 10) / 10,
          byCategory: Object.entries(categoryWaste).map(([cat, data]) => ({
            category: cat,
            expected: Math.round(data.expected * 100) / 100,
            actual: Math.round(data.actual * 100) / 100,
            wastePercent: data.expected > 0
              ? Math.round(((data.actual - data.expected) / data.expected) * 1000) / 10
              : 0,
            records: data.records
          })).sort((a, b) => b.wastePercent - a.wastePercent)
        },
        confidenceFormula
      },
      engineActivity: {
        summary: activitySummary,
        logs: (activityLogs || []).map(l => ({
          id: l.id,
          timestamp: l.created_at,
          activityType: l.activity_type,
          method: l.method,
          computationType: l.computation_type,
          invoicesUsed: l.input_invoice_count,
          consumptionUsed: l.input_consumption_count,
          productsUsed: l.input_product_count,
          confidence: l.confidence_score,
          status: l.result_status,
          summary: l.result_summary,
          executionMs: l.execution_time_ms,
          error: l.error_message,
          llm: l.llm_provider ? {
            provider: l.llm_provider,
            model: l.llm_model,
            tokens: l.llm_total_tokens,
            latencyMs: l.llm_latency_ms,
            cost: l.llm_cost_usd
          } : null,
          metadata: l.metadata
        }))
      },
      reorderRecommendations: {
        items: reorderRecommendations,
        summary: {
          totalItems: reorderRecommendations.length,
          criticalItems: reorderRecommendations.filter(r => r.priority === 'critical').length,
          urgentItems: reorderRecommendations.filter(r => r.priority === 'urgent').length,
          normalItems: reorderRecommendations.filter(r => r.priority === 'normal').length,
          totalEstimatedCost: Math.round(reorderRecommendations.reduce((s, r) => s + r.extendedCost, 0) * 100) / 100,
        },
        upcomingEstimates: upcomingEstimates.map(e => ({
          id: e.id,
          number: e.estimate_number,
          date: e.estimate_date,
          total: e.total_amount,
          status: e.status,
          vehicle: e.vehicle_info,
          insurance: e.insurance_company
        })),
        methodology: {
          avgDailyUsage: 'Total units consumed in period / Number of days in period',
          reorderPoint: '(Average Daily Usage × Lead Time Days) + Safety Stock',
          parLevel: 'Reorder Point + (Average Daily Usage × Order Cycle Days)',
          suggestedOrderQty: 'Par Level - Current Stock (minimum 0)',
          daysRemaining: 'Current Stock / Average Daily Usage',
          priorityCritical: 'Stock will run out within 3 days',
          priorityUrgent: 'Stock will run out within 7 days',
          priorityNormal: 'Stock is at or below reorder point',
        }
      },
      methodology: {
        projectionEngine: 'Rule-based statistical analysis using historical invoice and consumption data',
        dataWindow: `${periodDays}-day rolling window of invoices and consumption records`,
        minimumThresholds: '50 invoices + 100 consumption records required before generating projections',
        confidenceFormula: 'confidence = 20 (base) + min(invoices/50, 1) × 40 + min(consumption/200, 1) × 40',
        wasteCalculation: 'waste% = ((actual_quantity - estimated_quantity) / estimated_quantity) × 100',
        trendCalculation: 'Period-over-period comparison: consumption split into prior/current halves, real % change',
        reorderCalculation: 'Suggested Qty = Par Level - Current Stock; triggered when current stock ≤ reorder point or days remaining ≤ 7',
        noLLMStatement: 'All calculations use deterministic, rule-based and statistical methods. No LLM/AI models are used for projections, waste analysis, or reorder recommendations. Results are fully reproducible from the source data.',
        dataScoping: 'All queries are scoped to the specific company via company_id filters. No cross-company data leakage.',
      }
    })

  } catch (error: any) {
    console.error('Audit export error:', error)
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 })
  }
}
