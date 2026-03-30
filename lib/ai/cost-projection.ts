// AI Cost Projection Engine
// Analyzes historical data to predict future material costs and consumption

import { SupabaseClient } from '@supabase/supabase-js'
import { LaborRateService } from '@/lib/labor-rates'

// Types
export interface CostProjection {
  period: string
  startDate: string
  endDate: string
  estimatedJobs: number
  projectedMaterialCost: number
  projectedLaborCost: number
  projectedTotalCost: number
  confidence: number
  breakdown: CategoryBreakdown[]
  recommendations: Recommendation[]
}

export interface CategoryBreakdown {
  category: string
  projectedQuantity: number
  projectedCost: number
  percentOfTotal: number
  trend: 'up' | 'down' | 'stable'
  trendPercent: number
}

export interface Recommendation {
  type: 'order' | 'warning' | 'opportunity' | 'insight'
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  potentialSavings?: number
  action?: string
}

export interface WasteAnalysis {
  period: string
  totalMaterialCost: number
  actualUsed: number
  wastedAmount: number
  wastePercent: number
  wasteCost: number
  byCategory: CategoryWaste[]
  trends: WasteTrend[]
  suggestions: string[]
}

export interface CategoryWaste {
  category: string
  expectedUsage: number
  actualUsage: number
  waste: number
  wastePercent: number
  wasteCost: number
}

export interface WasteTrend {
  month: string
  wastePercent: number
}

export interface ConsumptionPattern {
  productId: string
  productName: string
  avgDailyUsage: number
  avgWeeklyUsage: number
  avgMonthlyUsage: number
  peakDay: string
  peakUsage: number
  lowDay: string
  lowUsage: number
  seasonalFactor: number
}

// Minimum data thresholds - hard gate before projecting
const MIN_INVOICES_FOR_PROJECTION = 50
const MIN_CONSUMPTION_FOR_PROJECTION = 100

export interface InsufficientDataResult {
  insufficient_data: true
  message: string
  invoiceCount: number
  consumptionCount: number
  requiredInvoices: number
  requiredConsumption: number
}

// Cost Projection Engine Class
export class CostProjectionEngine {
  private supabase: SupabaseClient
  private laborRateService: LaborRateService

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
    this.laborRateService = new LaborRateService(supabase)
  }

  // Generate cost projections for a given period
  async generateProjection(
    companyId: string,
    periodWeeks: number = 4
  ): Promise<CostProjection | InsufficientDataResult> {
    const startDate = new Date()
    const endDate = new Date()
    endDate.setDate(endDate.getDate() + periodWeeks * 7)

    // Get historical data - scoped to this company
    const [invoices, estimates, consumption, products] = await Promise.all([
      this.getHistoricalInvoices(companyId, 90), // Last 90 days
      this.getUpcomingEstimates(companyId),
      this.getConsumptionHistory(companyId, 90),
      this.getProducts(companyId)
    ])

    // HARD GATE: Require minimum data before projecting
    if (invoices.length < MIN_INVOICES_FOR_PROJECTION || consumption.length < MIN_CONSUMPTION_FOR_PROJECTION) {
      return {
        insufficient_data: true,
        message: `Insufficient data for reliable projections. Need at least ${MIN_INVOICES_FOR_PROJECTION} invoices (have ${invoices.length}) and ${MIN_CONSUMPTION_FOR_PROJECTION} consumption records (have ${consumption.length}) within the last 90 days.`,
        invoiceCount: invoices.length,
        consumptionCount: consumption.length,
        requiredInvoices: MIN_INVOICES_FOR_PROJECTION,
        requiredConsumption: MIN_CONSUMPTION_FOR_PROJECTION
      }
    }

    // Calculate averages - use actual labor/material breakdown if available
    const avgJobsPerWeek = invoices.length / 13 // 90 days = ~13 weeks

    // Calculate actual material and labor costs from invoices
    // If invoices have detailed breakdown, use that; otherwise estimate from total
    const avgMaterialCostPerJob = invoices.reduce((sum, inv) => {
      if (inv.total_materials_cost && inv.total_materials_cost > 0) {
        return sum + inv.total_materials_cost
      }
      if (inv.material_cost && inv.material_cost > 0) {
        return sum + inv.material_cost
      }
      // Fallback: estimate materials as 35% of total (industry average)
      return sum + ((inv.total_amount || 0) * 0.35)
    }, 0) / Math.max(invoices.length, 1)

    const avgLaborCostPerJob = invoices.reduce((sum, inv) => {
      if (inv.total_labor_cost && inv.total_labor_cost > 0) {
        return sum + inv.total_labor_cost
      }
      if (inv.labor_cost && inv.labor_cost > 0) {
        return sum + inv.labor_cost
      }
      // Fallback: estimate labor as 50% of total (industry average)
      return sum + ((inv.total_amount || 0) * 0.50)
    }, 0) / Math.max(invoices.length, 1)

    // Estimate jobs for projection period
    const scheduledJobs = estimates.length
    const projectedFromHistory = Math.round(avgJobsPerWeek * periodWeeks)
    const estimatedJobs = Math.max(scheduledJobs, projectedFromHistory)

    // Calculate projections
    const projectedMaterialCost = estimatedJobs * avgMaterialCostPerJob
    const projectedLaborCost = estimatedJobs * avgLaborCostPerJob
    const projectedTotalCost = projectedMaterialCost + projectedLaborCost

    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(invoices.length, consumption.length)

    // Generate category breakdown
    const breakdown = await this.generateCategoryBreakdown(
      consumption,
      products,
      estimatedJobs,
      avgJobsPerWeek * 13 // Historical jobs for comparison
    )

    // Generate recommendations
    const recommendations = await this.generateRecommendations(
      breakdown,
      products,
      consumption,
      estimates
    )

    return {
      period: `${periodWeeks} weeks`,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      estimatedJobs,
      projectedMaterialCost: Math.round(projectedMaterialCost * 100) / 100,
      projectedLaborCost: Math.round(projectedLaborCost * 100) / 100,
      projectedTotalCost: Math.round(projectedTotalCost * 100) / 100,
      confidence,
      breakdown,
      recommendations
    }
  }

  // Analyze waste patterns
  async analyzeWaste(
    companyId: string,
    periodDays: number = 30
  ): Promise<WasteAnalysis> {
    const consumption = await this.getConsumptionHistory(companyId, periodDays)
    const products = await this.getProducts(companyId)
    const invoices = await this.getHistoricalInvoices(companyId, periodDays)

    // Calculate totals - use actual_quantity from consumption_history schema
    const totalMaterialCost = consumption.reduce((sum, c) => {
      const qty = c.actual_quantity || c.quantity_used || 0
      const cost = c.cost_per_unit || 0
      const product = products.find(p => p.id === c.product_id)
      const unitCost = cost || product?.unit_cost || product?.cost || 0
      return sum + (qty * unitCost)
    }, 0)

    // Calculate waste by category
    const categoryMap = new Map<string, { expected: number; actual: number; cost: number }>()

    for (const c of consumption) {
      const product = products.find(p => p.id === c.product_id)
      if (!product) continue

      const category = product.category || 'Other'
      const existing = categoryMap.get(category) || { expected: 0, actual: 0, cost: 0 }

      // Use estimated_quantity as expected, actual_quantity as actual (from our schema)
      const expectedUsage = c.estimated_quantity || c.quantity_used || 0
      const actualUsage = c.actual_quantity || c.quantity_used || 0
      const unitCost = c.cost_per_unit || product.unit_cost || product.cost || 0

      categoryMap.set(category, {
        expected: existing.expected + expectedUsage,
        actual: existing.actual + actualUsage,
        cost: existing.cost + (actualUsage * unitCost)
      })
    }

    const byCategory: CategoryWaste[] = []
    let totalExpected = 0
    let totalActual = 0

    categoryMap.forEach((data, category) => {
      const waste = data.actual - data.expected
      const wastePercent = data.expected > 0 ? (waste / data.expected) * 100 : 0
      const product = products.find(p => p.category === category)
      const avgCost = product?.unit_cost || 50

      byCategory.push({
        category,
        expectedUsage: Math.round(data.expected * 100) / 100,
        actualUsage: Math.round(data.actual * 100) / 100,
        waste: Math.round(waste * 100) / 100,
        wastePercent: Math.round(wastePercent * 10) / 10,
        wasteCost: Math.round(waste * avgCost * 100) / 100
      })

      totalExpected += data.expected
      totalActual += data.actual
    })

    // Sort by waste cost
    byCategory.sort((a, b) => b.wasteCost - a.wasteCost)

    const totalWaste = totalActual - totalExpected
    const overallWastePercent = totalExpected > 0 ? (totalWaste / totalExpected) * 100 : 0

    // Calculate real waste trends from consumption data grouped by month
    const monthlyWaste = new Map<string, { expected: number; actual: number }>()
    for (const c of consumption) {
      const date = new Date(c.completion_date || c.created_at)
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      const existing = monthlyWaste.get(monthKey) || { expected: 0, actual: 0 }
      existing.expected += c.estimated_quantity || 0
      existing.actual += c.actual_quantity || c.quantity_used || 0
      monthlyWaste.set(monthKey, existing)
    }

    const trends: WasteTrend[] = Array.from(monthlyWaste.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6) // Last 6 months
      .map(([key, data]) => {
        const [year, month] = key.split('-').map(Number)
        const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'short' })
        const waste = data.actual - data.expected
        const wastePercent = data.expected > 0 ? (waste / data.expected) * 100 : 0
        return {
          month: monthName,
          wastePercent: Math.round(wastePercent * 10) / 10
        }
      })

    // Generate suggestions
    const suggestions = this.generateWasteSuggestions(byCategory)

    return {
      period: `Last ${periodDays} days`,
      totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
      actualUsed: Math.round(totalActual * 100) / 100,
      wastedAmount: Math.round(totalWaste * 100) / 100,
      wastePercent: Math.round(overallWastePercent * 10) / 10,
      wasteCost: Math.round(byCategory.reduce((sum, c) => sum + c.wasteCost, 0) * 100) / 100,
      byCategory,
      trends,
      suggestions
    }
  }

  // Analyze consumption patterns
  async analyzeConsumptionPatterns(
    companyId: string
  ): Promise<ConsumptionPattern[]> {
    const consumption = await this.getConsumptionHistory(companyId, 90)
    const products = await this.getProducts(companyId)

    const patterns: ConsumptionPattern[] = []

    // Group consumption by product
    const productConsumption = new Map<string, { dates: Date[]; quantities: number[] }>()

    for (const c of consumption) {
      const existing = productConsumption.get(c.product_id) || { dates: [], quantities: [] }
      existing.dates.push(new Date(c.completion_date || c.transaction_date || c.created_at))
      existing.quantities.push(c.actual_quantity || c.quantity_used || 0)
      productConsumption.set(c.product_id, existing)
    }

    productConsumption.forEach((data, productId) => {
      const product = products.find(p => p.id === productId)
      if (!product) return

      const totalQty = data.quantities.reduce((sum, q) => sum + q, 0)
      const avgDaily = totalQty / 90
      const avgWeekly = avgDaily * 7
      const avgMonthly = avgDaily * 30

      // Calculate day-of-week patterns
      const dayTotals = [0, 0, 0, 0, 0, 0, 0]
      const dayCounts = [0, 0, 0, 0, 0, 0, 0]

      data.dates.forEach((date, i) => {
        const day = date.getDay()
        dayTotals[day] += data.quantities[i]
        dayCounts[day]++
      })

      const dayAverages = dayTotals.map((total, i) =>
        dayCounts[i] > 0 ? total / dayCounts[i] : 0
      )

      const peakDayIndex = dayAverages.indexOf(Math.max(...dayAverages))
      const lowDayIndex = dayAverages.indexOf(Math.min(...dayAverages.filter(d => d > 0)))

      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

      patterns.push({
        productId,
        productName: product.name,
        avgDailyUsage: Math.round(avgDaily * 100) / 100,
        avgWeeklyUsage: Math.round(avgWeekly * 100) / 100,
        avgMonthlyUsage: Math.round(avgMonthly * 100) / 100,
        peakDay: days[peakDayIndex],
        peakUsage: Math.round(dayAverages[peakDayIndex] * 100) / 100,
        lowDay: days[lowDayIndex] || 'N/A',
        lowUsage: Math.round((dayAverages[lowDayIndex] || 0) * 100) / 100,
        seasonalFactor: 1.0 // Would need more data for seasonal analysis
      })
    })

    return patterns.sort((a, b) => b.avgMonthlyUsage - a.avgMonthlyUsage)
  }

  // Calculate labor cost for an estimate using insurance rates
  async calculateEstimateLaborCost(
    companyId: string,
    insuranceCompanyId: string,
    laborHours: {
      body?: number
      refinish?: number
      mechanical?: number
      structural?: number
      aluminum?: number
      glass?: number
    }
  ) {
    return this.laborRateService.calculateLaborCost(companyId, insuranceCompanyId, {
      body_labor_hours: laborHours.body || 0,
      refinish_labor_hours: laborHours.refinish || 0,
      mechanical_labor_hours: laborHours.mechanical || 0,
      structural_labor_hours: laborHours.structural || 0,
      aluminum_labor_hours: laborHours.aluminum || 0,
      glass_labor_hours: laborHours.glass || 0
    })
  }

  // Get labor rates for a specific insurance company
  async getInsuranceLaborRates(companyId: string, insuranceCompanyId: string) {
    return this.laborRateService.getLaborRatesForInsurance(companyId, insuranceCompanyId)
  }

  // Private helper methods
  private async getHistoricalInvoices(companyId: string, days: number) {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const { data } = await this.supabase
      .from('invoices')
      .select('*')
      .eq('company_id', companyId)
      .gte('invoice_date', startDate.toISOString().split('T')[0])
      .order('invoice_date', { ascending: false })

    return data || []
  }

  private async getUpcomingEstimates(companyId: string) {
    const { data } = await this.supabase
      .from('estimates')
      .select('*')
      .gte('expected_start_date', new Date().toISOString().split('T')[0])
      .in('status', ['Quoted', 'Approved', 'Scheduled'])
      .order('expected_start_date', { ascending: true })

    return data || []
  }

  private async getConsumptionHistory(companyId: string, days: number) {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Try completion_date first (our schema), fall back to created_at
    const { data } = await this.supabase
      .from('consumption_history')
      .select('*, invoice:invoices!invoice_id(company_id)')
      .gte('completion_date', startDate.toISOString().split('T')[0])
      .order('completion_date', { ascending: false })

    // Filter to company's invoices if join worked
    const filtered = data?.filter(c => {
      if (!c.invoice) return true // If no join, include all
      return c.invoice.company_id === companyId
    }) || []

    return filtered
  }

  private async getProducts(companyId: string) {
    const { data } = await this.supabase
      .from('products')
      .select('*')
      .eq('company_id', companyId)

    return data || []
  }

  private calculateConfidence(invoiceCount: number, consumptionCount: number): number {
    // More data = higher confidence
    const invoiceScore = Math.min(invoiceCount / 50, 1) * 40 // Max 40 points
    const consumptionScore = Math.min(consumptionCount / 200, 1) * 40 // Max 40 points
    const baseScore = 20 // Base confidence

    return Math.round(baseScore + invoiceScore + consumptionScore)
  }

  private async generateCategoryBreakdown(
    consumption: any[],
    products: any[],
    projectedJobs: number,
    historicalJobs: number
  ): Promise<CategoryBreakdown[]> {
    // Split consumption into current half and prior half for real trend comparison
    const sorted = [...consumption].sort((a, b) =>
      new Date(a.completion_date || a.created_at).getTime() - new Date(b.completion_date || b.created_at).getTime()
    )
    const midpoint = Math.floor(sorted.length / 2)
    const priorHalf = sorted.slice(0, midpoint)
    const currentHalf = sorted.slice(midpoint)

    // Build category cost maps for both periods
    const buildCategoryMap = (records: any[]) => {
      const map = new Map<string, { qty: number; cost: number }>()
      for (const c of records) {
        const product = products.find(p => p.id === c.product_id)
        if (!product) continue
        const category = product.category || 'Other'
        const existing = map.get(category) || { qty: 0, cost: 0 }
        const qty = c.actual_quantity || c.quantity_used || 0
        const unitCost = c.cost_per_unit || product.unit_cost || product.cost || 0
        map.set(category, {
          qty: existing.qty + qty,
          cost: existing.cost + (qty * unitCost)
        })
      }
      return map
    }

    const currentMap = buildCategoryMap(currentHalf)
    const priorMap = buildCategoryMap(priorHalf)
    // Full period map for totals
    const fullMap = buildCategoryMap(consumption)

    const totalCost = Array.from(fullMap.values()).reduce((sum, c) => sum + c.cost, 0)
    const scaleFactor = historicalJobs > 0 ? projectedJobs / historicalJobs : 1

    const breakdown: CategoryBreakdown[] = []
    fullMap.forEach((data, category) => {
      const projectedQty = data.qty * scaleFactor
      const projectedCost = data.cost * scaleFactor
      const percentOfTotal = totalCost > 0 ? (data.cost / totalCost) * 100 : 0

      // Real trend: compare current period cost to prior period cost
      const currentCost = currentMap.get(category)?.cost || 0
      const priorCost = priorMap.get(category)?.cost || 0
      const trendPercent = priorCost > 0 ? ((currentCost - priorCost) / priorCost) * 100 : 0
      const trend: 'up' | 'down' | 'stable' = trendPercent > 5 ? 'up' : trendPercent < -5 ? 'down' : 'stable'

      breakdown.push({
        category,
        projectedQuantity: Math.round(projectedQty * 100) / 100,
        projectedCost: Math.round(projectedCost * 100) / 100,
        percentOfTotal: Math.round(percentOfTotal * 10) / 10,
        trend,
        trendPercent: Math.round(Math.abs(trendPercent) * 10) / 10
      })
    })

    return breakdown.sort((a, b) => b.projectedCost - a.projectedCost)
  }

  private async generateRecommendations(
    breakdown: CategoryBreakdown[],
    products: any[],
    consumption: any[],
    estimates: any[]
  ): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = []

    // Check for increasing costs
    breakdown.forEach(b => {
      if (b.trend === 'up' && b.trendPercent > 10) {
        recommendations.push({
          type: 'warning',
          priority: 'high',
          title: `${b.category} costs increasing`,
          description: `${b.category} spending is up ${b.trendPercent}% compared to the previous period. Review usage patterns and consider alternative suppliers.`,
          potentialSavings: b.projectedCost * 0.1
        })
      }
    })

    // Check for upcoming work requiring materials
    if (estimates.length > 5) {
      const totalEstimateValue = estimates.reduce((sum, e) => sum + (e.total_amount || 0), 0)
      recommendations.push({
        type: 'order',
        priority: 'high',
        title: 'Stock up for upcoming jobs',
        description: `You have ${estimates.length} scheduled jobs worth $${totalEstimateValue.toLocaleString()}. Ensure adequate material inventory.`,
        action: 'Review inventory levels'
      })
    }

    // Identify savings opportunities
    const highCostCategories = breakdown.filter(b => b.percentOfTotal > 25)
    highCostCategories.forEach(b => {
      recommendations.push({
        type: 'opportunity',
        priority: 'medium',
        title: `Optimize ${b.category} purchases`,
        description: `${b.category} represents ${b.percentOfTotal}% of material costs. Consider bulk ordering or negotiating better rates.`,
        potentialSavings: b.projectedCost * 0.05
      })
    })

    // General insights
    if (breakdown.length > 0) {
      recommendations.push({
        type: 'insight',
        priority: 'low',
        title: 'Diversified material usage',
        description: `Using products across ${breakdown.length} categories. Monitor for any single category exceeding 40% of total spend.`
      })
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })
  }

  private generateWasteSuggestions(byCategory: CategoryWaste[]): string[] {
    const suggestions: string[] = []

    byCategory.forEach(c => {
      if (c.wastePercent > 20) {
        suggestions.push(`Reduce ${c.category} waste by improving mixing accuracy and using digital scales`)
      }
      if (c.wastePercent > 15 && c.category.includes('Clear')) {
        suggestions.push(`Consider using smaller clear coat containers for small repairs to reduce waste`)
      }
    })

    if (suggestions.length === 0) {
      suggestions.push('Waste levels are within acceptable ranges. Continue monitoring.')
    }

    suggestions.push('Implement a color formula tracking system to reduce over-mixing')
    suggestions.push('Train staff on accurate material estimation techniques')

    return suggestions.slice(0, 5)
  }
}

// Utility function to create engine instance
export function createCostProjectionEngine(supabase: SupabaseClient): CostProjectionEngine {
  return new CostProjectionEngine(supabase)
}
