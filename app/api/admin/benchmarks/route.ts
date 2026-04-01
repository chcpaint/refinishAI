import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Super Admin only — Industry Benchmarks API
// Aggregates anonymized data across ALL companies for benchmarking

interface CompanyMetrics {
  companyId: string
  city: string | null
  state: string | null
  invoiceCount: number
  avgInvoiceTotal: number
  avgMaterialCost: number
  avgLaborCost: number
  wastePercent: number
  avgPartsPerJob: number
  avgCycleTimeDays: number
  consumptionCount: number
  avgVariancePct: number
}

interface BenchmarkGroup {
  groupKey: string
  groupLabel: string
  companyCount: number
  metrics: {
    avgInvoiceTotal: { best: number; mean: number; worst: number }
    avgMaterialCost: { best: number; mean: number; worst: number }
    avgLaborCost: { best: number; mean: number; worst: number }
    wastePercent: { best: number; mean: number; worst: number }
    avgPartsPerJob: { best: number; mean: number; worst: number }
    avgCycleTimeDays: { best: number; mean: number; worst: number }
    avgVariancePct: { best: number; mean: number; worst: number }
  }
}

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
    const groupBy = searchParams.get('groupBy') || 'state' // state | city | all
    const periodDays = parseInt(searchParams.get('periodDays') || '90', 10)

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - periodDays)
    const startStr = startDate.toISOString().split('T')[0]

    // Get all real companies (exclude System and test placeholders)
    const { data: companies } = await supabase
      .from('companies')
      .select('id, name, city, state, zip')
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .neq('name', 'System')

    if (!companies || companies.length === 0) {
      return NextResponse.json({ error: 'No companies found' }, { status: 404 })
    }

    // Gather metrics per company
    const companyMetrics: CompanyMetrics[] = []

    for (const company of companies) {
      // Skip companies with no geographic data when grouping by geography
      if (groupBy !== 'all' && !company.state) continue

      // Get invoices for period
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, total_amount, material_cost, labor_cost, parts_count, created_at, completion_date')
        .eq('company_id', company.id)
        .gte('created_at', startStr)

      // Get consumption for period
      const { data: consumption } = await supabase
        .from('consumption_history')
        .select('estimated_quantity, actual_quantity, variance_pct, completion_date')
        .gte('completion_date', startStr)
        .in('invoice_id', (invoices || []).map(i => i.id))

      const invCount = invoices?.length || 0
      const consCount = consumption?.length || 0

      // Skip companies with no activity
      if (invCount === 0 && consCount === 0) continue

      // Invoice metrics
      const avgInvoiceTotal = invCount > 0
        ? invoices!.reduce((s, i) => s + (i.total_amount || 0), 0) / invCount
        : 0
      const avgMaterialCost = invCount > 0
        ? invoices!.reduce((s, i) => s + (i.material_cost || 0), 0) / invCount
        : 0
      const avgLaborCost = invCount > 0
        ? invoices!.reduce((s, i) => s + (i.labor_cost || 0), 0) / invCount
        : 0
      const avgPartsPerJob = invCount > 0
        ? invoices!.reduce((s, i) => s + (i.parts_count || 0), 0) / invCount
        : 0

      // Cycle time (created → completion)
      let totalCycleDays = 0
      let cycleCount = 0
      for (const inv of invoices || []) {
        if (inv.completion_date && inv.created_at) {
          const diff = new Date(inv.completion_date).getTime() - new Date(inv.created_at).getTime()
          totalCycleDays += diff / (1000 * 60 * 60 * 24)
          cycleCount++
        }
      }
      const avgCycleTimeDays = cycleCount > 0 ? totalCycleDays / cycleCount : 0

      // Waste metrics from consumption
      let totalExpected = 0
      let totalActual = 0
      let totalVariance = 0
      let varianceCount = 0
      for (const c of consumption || []) {
        totalExpected += c.estimated_quantity || 0
        totalActual += c.actual_quantity || 0
        if (c.variance_pct !== null && c.variance_pct !== undefined) {
          totalVariance += Math.abs(c.variance_pct)
          varianceCount++
        }
      }
      const wastePercent = totalExpected > 0
        ? ((totalActual - totalExpected) / totalExpected) * 100
        : 0
      const avgVariancePct = varianceCount > 0 ? totalVariance / varianceCount : 0

      companyMetrics.push({
        companyId: company.id,
        city: company.city,
        state: company.state,
        invoiceCount: invCount,
        avgInvoiceTotal: Math.round(avgInvoiceTotal * 100) / 100,
        avgMaterialCost: Math.round(avgMaterialCost * 100) / 100,
        avgLaborCost: Math.round(avgLaborCost * 100) / 100,
        wastePercent: Math.round(wastePercent * 10) / 10,
        avgPartsPerJob: Math.round(avgPartsPerJob * 10) / 10,
        avgCycleTimeDays: Math.round(avgCycleTimeDays * 10) / 10,
        consumptionCount: consCount,
        avgVariancePct: Math.round(avgVariancePct * 10) / 10
      })
    }

    if (companyMetrics.length === 0) {
      return NextResponse.json({
        benchmarks: [],
        overall: null,
        message: 'No companies with activity in the selected period'
      })
    }

    // Group companies
    const groups = new Map<string, CompanyMetrics[]>()
    for (const cm of companyMetrics) {
      let key: string
      let label: string
      switch (groupBy) {
        case 'city':
          key = `${cm.city || 'Unknown'}, ${cm.state || 'Unknown'}`
          label = key
          break
        case 'state':
          key = cm.state || 'Unknown'
          label = key
          break
        default:
          key = 'all'
          label = 'All Companies'
      }
      const existing = groups.get(key) || []
      existing.push(cm)
      groups.set(key, existing)
    }

    // Build benchmark aggregates per group
    const benchmarks: BenchmarkGroup[] = []
    for (const [key, members] of Array.from(groups.entries())) {
      if (members.length === 0) continue

      const computeStats = (getValue: (m: CompanyMetrics) => number, lowerIsBetter: boolean) => {
        const values = members.map(getValue).filter(v => v > 0)
        if (values.length === 0) return { best: 0, mean: 0, worst: 0 }
        const sorted = [...values].sort((a, b) => a - b)
        const mean = values.reduce((s, v) => s + v, 0) / values.length
        return {
          best: Math.round((lowerIsBetter ? sorted[0] : sorted[sorted.length - 1]) * 100) / 100,
          mean: Math.round(mean * 100) / 100,
          worst: Math.round((lowerIsBetter ? sorted[sorted.length - 1] : sorted[0]) * 100) / 100
        }
      }

      benchmarks.push({
        groupKey: key,
        groupLabel: key === 'all' ? 'All Companies' : key,
        companyCount: members.length,
        metrics: {
          avgInvoiceTotal: computeStats(m => m.avgInvoiceTotal, false),
          avgMaterialCost: computeStats(m => m.avgMaterialCost, true),
          avgLaborCost: computeStats(m => m.avgLaborCost, true),
          wastePercent: computeStats(m => m.wastePercent, true),
          avgPartsPerJob: computeStats(m => m.avgPartsPerJob, false),
          avgCycleTimeDays: computeStats(m => m.avgCycleTimeDays, true),
          avgVariancePct: computeStats(m => m.avgVariancePct, true)
        }
      })
    }

    // Also compute overall (all companies)
    const computeOverall = (getValue: (m: CompanyMetrics) => number, lowerIsBetter: boolean) => {
      const values = companyMetrics.map(getValue).filter(v => v > 0)
      if (values.length === 0) return { best: 0, mean: 0, worst: 0 }
      const sorted = [...values].sort((a, b) => a - b)
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      return {
        best: Math.round((lowerIsBetter ? sorted[0] : sorted[sorted.length - 1]) * 100) / 100,
        mean: Math.round(mean * 100) / 100,
        worst: Math.round((lowerIsBetter ? sorted[sorted.length - 1] : sorted[0]) * 100) / 100
      }
    }

    const overall: BenchmarkGroup = {
      groupKey: 'overall',
      groupLabel: 'All Companies (Overall)',
      companyCount: companyMetrics.length,
      metrics: {
        avgInvoiceTotal: computeOverall(m => m.avgInvoiceTotal, false),
        avgMaterialCost: computeOverall(m => m.avgMaterialCost, true),
        avgLaborCost: computeOverall(m => m.avgLaborCost, true),
        wastePercent: computeOverall(m => m.wastePercent, true),
        avgPartsPerJob: computeOverall(m => m.avgPartsPerJob, false),
        avgCycleTimeDays: computeOverall(m => m.avgCycleTimeDays, true),
        avgVariancePct: computeOverall(m => m.avgVariancePct, true)
      }
    }

    return NextResponse.json({
      benchmarks: benchmarks.sort((a, b) => b.companyCount - a.companyCount),
      overall,
      periodDays,
      groupBy,
      totalCompanies: companyMetrics.length,
      generatedAt: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('Benchmarks API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
