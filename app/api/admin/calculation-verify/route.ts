import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Super Admin only — Calculation Verification API
// Generates on-demand calculation verification report comparing reorder calculations
// across multiple companies to detect formula inconsistencies

interface CompanySettings {
  id: string
  name: string
  settings: {
    deliveriesPerWeek: number
    leadTimeDays: number
    safetyStockDays: number
    daysBetweenDeliveries: number
    reorderPoint: number
    defaultOrderQty: number
  }
}

interface ProductCalculation {
  sku: string
  name: string
  category: string
  [key: string]: any // Dynamic company calculation results
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
    const companyA = searchParams.get('companyA') || null
    const companyB = searchParams.get('companyB') || null

    // Fetch all companies if none specified
    const { data: allCompanies } = await supabase
      .from('companies')
      .select('id, name')
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .neq('name', 'System')
      .limit(100)

    if (!allCompanies || allCompanies.length === 0) {
      return NextResponse.json({ error: 'No companies found' }, { status: 404 })
    }

    // Determine which companies to analyze
    const companiesToAnalyze: string[] = []
    if (companyA && companyB) {
      companiesToAnalyze.push(companyA, companyB)
    } else if (companyA) {
      companiesToAnalyze.push(companyA)
    } else {
      // Use first 2 companies if none specified
      companiesToAnalyze.push(
        ...allCompanies.slice(0, 2).map(c => c.id)
      )
    }

    // Fetch settings for selected companies
    const { data: settingsData } = await supabase
      .from('company_reorder_settings')
      .select('*')
      .in('company_id', companiesToAnalyze)

    // Build company metadata
    const companiesInfo: CompanySettings[] = []
    for (const compId of companiesToAnalyze) {
      const company = allCompanies.find(c => c.id === compId)
      const settings = settingsData?.find(s => s.company_id === compId)

      const deliveriesPerWeek = settings?.deliveries_per_week || 2
      const leadTimeDays = settings?.lead_time_days || 1
      const safetyStockDays = settings?.safety_stock_days || 2
      const daysBetweenDeliveries = 7 / deliveriesPerWeek
      const reorderPoint = settings?.default_reorder_point || 3
      const defaultOrderQty = settings?.default_order_quantity || 4

      companiesInfo.push({
        id: compId,
        name: company?.name || 'Unknown',
        settings: {
          deliveriesPerWeek,
          leadTimeDays,
          safetyStockDays,
          daysBetweenDeliveries: Math.round(daysBetweenDeliveries * 100) / 100,
          reorderPoint,
          defaultOrderQty
        }
      })
    }

    // Fetch 90-day consumption history
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const { data: consumption } = await supabase
      .from('consumption_history')
      .select('product_id, quantity_used, created_at')
      .gte('created_at', ninetyDaysAgo.toISOString())

    // Build consumption map
    const consumptionMap = new Map<string, number>()
    for (const c of consumption || []) {
      const current = consumptionMap.get(c.product_id) || 0
      consumptionMap.set(c.product_id, current + (c.quantity_used || 0))
    }

    // Fetch all products with inventory stock (for all companies in scope)
    const { data: products } = await supabase
      .from('products')
      .select(`
        id,
        sku,
        name,
        category,
        quantity_on_hand,
        stock:inventory_stock(
          quantity_on_hand,
          shop_id
        )
      `)
      .in('company_id', companiesToAnalyze)
      .eq('is_active', true)
      .order('sku')

    // Group products by SKU for comparison
    const productsBySkuMap = new Map<string, any[]>()
    for (const product of products || []) {
      const sku = product.sku || 'unknown'
      if (!productsBySkuMap.has(sku)) {
        productsBySkuMap.set(sku, [])
      }
      productsBySkuMap.get(sku)!.push(product)
    }

    // Calculate formulas for each company/product combination
    const productCalculations: ProductCalculation[] = []
    let matchingCalcs = 0
    let totalComparisons = 0

    for (const [sku, productList] of Array.from(productsBySkuMap.entries())) {
      const baseProduct = productList[0]
      const calculation: ProductCalculation = {
        sku,
        name: baseProduct.name || 'Unknown',
        category: baseProduct.category || 'Uncategorized'
      }

      const companyResults: any[] = []

      // Calculate for each company
      for (const companyInfo of companiesInfo) {
        const product = productList.find(p => p.company_id === companyInfo.id) || productList[0]
        const totalUsed90Days = consumptionMap.get(product.id) || 0

        // Get current stock for this company
        let currentStock = product.quantity_on_hand || 0
        if (product.stock && Array.isArray(product.stock)) {
          const companyStock = product.stock.find((s: any) => s.shop_id === companyInfo.id)
          if (companyStock) {
            currentStock = companyStock.quantity_on_hand || 0
          }
        }

        // Calculate formulas (exactly as in reorder-report.ts)
        const avgDailyUsage = totalUsed90Days / 90
        const avgWeeklyUsage = avgDailyUsage * 7
        const daysBetweenDeliveries = 7 / companyInfo.settings.deliveriesPerWeek
        const daysOfStockRemaining = avgDailyUsage > 0
          ? Math.round(currentStock / avgDailyUsage)
          : (currentStock > 0 ? 999 : 0)

        // Calculate suggested quantity
        let suggestedQty: number
        if (avgDailyUsage > 0) {
          const usageTilNextDelivery = avgDailyUsage * daysBetweenDeliveries
          const safetyQty = avgDailyUsage * companyInfo.settings.safetyStockDays
          suggestedQty = Math.ceil(usageTilNextDelivery + safetyQty) - currentStock
          suggestedQty = Math.max(suggestedQty, companyInfo.settings.defaultOrderQty)
        } else {
          const parLevel = companyInfo.settings.reorderPoint + companyInfo.settings.defaultOrderQty
          suggestedQty = Math.max(parLevel - currentStock, companyInfo.settings.defaultOrderQty)
        }
        suggestedQty = Math.max(suggestedQty, 1)

        // Determine priority
        const criticalThresholdDays = Math.max(1, Math.floor(daysBetweenDeliveries))
        const urgentThresholdDays = Math.max(3, Math.ceil(daysBetweenDeliveries * 2))
        const effectiveLeadTime = companyInfo.settings.leadTimeDays + companyInfo.settings.safetyStockDays

        let priority: string
        let priorityReason: string

        if (currentStock <= 0) {
          priority = 'critical'
          priorityReason = 'Out of stock'
        } else if (daysOfStockRemaining <= criticalThresholdDays) {
          priority = 'critical'
          priorityReason = `Only ${daysOfStockRemaining} days of stock (≤${criticalThresholdDays})`
        } else if (daysOfStockRemaining <= urgentThresholdDays) {
          priority = 'urgent'
          priorityReason = `${daysOfStockRemaining} days of stock (≤${urgentThresholdDays})`
        } else if (currentStock <= companyInfo.settings.reorderPoint) {
          priority = 'normal'
          priorityReason = `Below reorder point (${currentStock} ≤ ${companyInfo.settings.reorderPoint})`
        } else if (daysOfStockRemaining <= effectiveLeadTime) {
          priority = 'normal'
          priorityReason = `Stock covers ${daysOfStockRemaining} days, lead time is ${effectiveLeadTime} days`
        } else {
          priority = 'optional'
          priorityReason = 'Adequate stock level'
        }

        companyResults.push({
          companyId: companyInfo.id,
          companyName: companyInfo.name,
          currentStock,
          totalUsed90Days: Math.round(totalUsed90Days * 100) / 100,
          avgDailyUsage: Math.round(avgDailyUsage * 100) / 100,
          avgWeeklyUsage: Math.round(avgWeeklyUsage * 100) / 100,
          daysOfStockRemaining,
          suggestedQty: Math.round(suggestedQty),
          priority,
          priorityReason
        })
      }

      // Add company results to calculation
      for (const result of companyResults) {
        const key = `${result.companyId}__currentStock`
        calculation[key] = result.currentStock
        calculation[`${result.companyId}__totalUsed90Days`] = result.totalUsed90Days
        calculation[`${result.companyId}__avgDailyUsage`] = result.avgDailyUsage
        calculation[`${result.companyId}__avgWeeklyUsage`] = result.avgWeeklyUsage
        calculation[`${result.companyId}__daysOfStockRemaining`] = result.daysOfStockRemaining
        calculation[`${result.companyId}__suggestedQty`] = result.suggestedQty
        calculation[`${result.companyId}__priority`] = result.priority
        calculation[`${result.companyId}__priorityReason`] = result.priorityReason
      }

      // Store company results for comparison
      calculation.__companyResults = companyResults

      productCalculations.push(calculation)

      // Check for matching priorities
      if (companyResults.length >= 2) {
        totalComparisons++
        const priorities = companyResults.map(r => r.priority)
        if (priorities.every((p, _, arr) => p === arr[0])) {
          matchingCalcs++
        }
      }
    }

    // Build formula reference
    const formulaReference = {
      avgDailyUsage: 'totalUsed90Days / 90',
      avgWeeklyUsage: 'avgDailyUsage * 7',
      daysBetweenDeliveries: '7 / deliveries_per_week',
      daysOfStockRemaining: 'avgDailyUsage > 0 ? Math.round(currentStock / avgDailyUsage) : (currentStock > 0 ? 999 : 0)',
      suggestedQty: 'Math.ceil(avgDailyUsage * daysBetweenDeliveries + avgDailyUsage * safetyStockDays) - currentStock, then Math.max(suggestedQty, default_order_quantity)',
      criticalThresholdDays: 'Math.max(1, Math.floor(daysBetweenDeliveries))',
      urgentThresholdDays: 'Math.max(3, Math.ceil(daysBetweenDeliveries * 2))',
      effectiveLeadTime: 'leadTimeDays + safetyStockDays',
      priority: 'critical (stock=0 OR days<=criticalThreshold), urgent (days<=urgentThreshold), normal (stock<=reorderPoint OR days<=effectiveLeadTime), optional (else)'
    }

    // Clean up product calculations to remove internal working fields
    const cleanedProducts = productCalculations.map(calc => {
      const cleaned = { ...calc }
      delete (cleaned as any).__companyResults
      return cleaned
    })

    return NextResponse.json({
      companies: companiesInfo,
      products: cleanedProducts,
      formulaReference,
      generatedAt: new Date().toISOString(),
      summary: {
        totalProducts: cleanedProducts.length,
        matchingCalculations: matchingCalcs,
        mismatchCount: totalComparisons - matchingCalcs,
        totalComparisons
      }
    })

  } catch (error: any) {
    console.error('Calculation verify API error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
