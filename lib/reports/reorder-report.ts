// Comprehensive Reorder Report System
// Generates detailed reorder recommendations with full product information

import { SupabaseClient } from '@supabase/supabase-js'
import { getPaintLineFilter, shouldIncludeProduct, type PaintLineFilter } from '@/lib/services/paint-line-filter'

// Types
export interface ReorderItem {
  // Product identification
  id: string
  productId: string
  sku: string
  productName: string
  category: string
  manufacturer: string | null
  vendorCode: string | null

  // Inventory levels
  currentStock: number
  reorderPoint: number
  parLevel: number
  unit: string

  // Order calculation
  suggestedOrderQty: number
  minOrderQty: number
  orderMultiple: number

  // Costing
  unitCost: number
  extendedCost: number

  // Supplier info
  supplierId: string | null
  supplierName: string | null
  supplierSku: string | null
  leadTimeDays: number

  // Analysis
  avgDailyUsage: number
  avgWeeklyUsage: number
  daysOfStockRemaining: number
  priority: 'critical' | 'urgent' | 'normal' | 'optional'
  priorityReason: string

  // Status
  lastOrderDate: string | null
  lastCountDate: string | null
  locationBin: string | null
}

export interface ReorderReport {
  generatedAt: string
  companyId: string
  companyName: string
  reportPeriod: string

  // Summary
  summary: {
    totalItems: number
    criticalItems: number
    urgentItems: number
    normalItems: number
    optionalItems: number
    totalEstimatedCost: number
    totalSkusToOrder: number
  }

  // Detailed items
  items: ReorderItem[]

  // Metadata
  settings: {
    leadTimeSafetyBuffer: number
    criticalThresholdDays: number
    urgentThresholdDays: number
    includeOptional: boolean
  }

  // Company presets used for this report
  companyPresets: {
    defaultReorderPoint: number
    defaultOrderQuantity: number
    deliveriesPerWeek: number
    deliverySchedule: string
    deliveryDays: string[]
    leadTimeDays: number
    daysBetweenDeliveries: number
    safetyStockDays: number
    maxInventoryDollars: number | null
    minInventoryDollars: number | null
  }
}

export interface CompanyReorderSettings {
  default_reorder_point: number
  default_order_quantity: number
  deliveries_per_week: number
  delivery_schedule: string
  delivery_days: string[]
  lead_time_days: number
  max_inventory_dollars: number | null
  min_inventory_dollars: number | null
  target_inventory_dollars: number | null
  safety_stock_days: number
  safety_stock_method: string
  safety_stock_value: number
  order_multiple: number
  min_order_value: number | null
  consolidate_orders: boolean
}

export interface ReorderReportOptions {
  leadTimeSafetyBuffer?: number // Extra days buffer (default: 3)
  criticalThresholdDays?: number // Days until stockout = critical (default: 3)
  urgentThresholdDays?: number // Days until stockout = urgent (default: 7)
  includeOptional?: boolean // Include items above reorder point
  categoryFilter?: string[] // Filter by categories
  supplierFilter?: string // Filter by supplier
  priorityFilter?: ('critical' | 'urgent' | 'normal' | 'optional')[]
}

export class ReorderReportService {
  private supabase: SupabaseClient

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  async generateReport(
    companyId: string,
    options: ReorderReportOptions = {},
    paintLineFilter?: PaintLineFilter
  ): Promise<ReorderReport> {
    // Fetch company reorder presets (or use defaults)
    const { data: companyPresets } = await this.supabase
      .from('company_reorder_settings')
      .select('*')
      .eq('company_id', companyId)
      .single()

    const presets: CompanyReorderSettings = companyPresets || {
      default_reorder_point: 3,
      default_order_quantity: 4,
      deliveries_per_week: 2,
      delivery_schedule: 'twice_weekly',
      delivery_days: ['Tuesday', 'Thursday'],
      lead_time_days: 1,
      max_inventory_dollars: null,
      min_inventory_dollars: null,
      target_inventory_dollars: null,
      safety_stock_days: 2,
      safety_stock_method: 'days_of_supply',
      safety_stock_value: 2,
      order_multiple: 1,
      min_order_value: null,
      consolidate_orders: true
    }

    // Days between deliveries — this is the key replenishment window
    const daysBetweenDeliveries = presets.deliveries_per_week > 0
      ? 7 / presets.deliveries_per_week
      : 7

    const settings = {
      leadTimeSafetyBuffer: options.leadTimeSafetyBuffer ?? presets.safety_stock_days,
      criticalThresholdDays: options.criticalThresholdDays ?? Math.max(1, Math.floor(daysBetweenDeliveries)),
      urgentThresholdDays: options.urgentThresholdDays ?? Math.max(3, Math.ceil(daysBetweenDeliveries * 2)),
      includeOptional: options.includeOptional ?? true
    }

    // Get company info
    const { data: company } = await this.supabase
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single()

    // Get all products with inventory data and stock levels
    const { data: products } = await this.supabase
      .from('products')
      .select(`
        *,
        supplier:supplier_products(
          supplier_id,
          supplier_sku,
          supplier_price,
          lead_time_days
        ),
        stock:inventory_stock!product_id(
          quantity_on_hand,
          reorder_point,
          reorder_quantity,
          shop_id
        )
      `)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')

    // Apply paint line contract filter if provided
    // This ensures only the contracted manufacturer's paint products show
    // while non-paint products (abrasives, consumables, etc.) show from all vendors
    let filteredProducts = products || []
    if (paintLineFilter) {
      filteredProducts = filteredProducts.filter(product =>
        shouldIncludeProduct(product, paintLineFilter)
      )
    }

    // Get consumption history for usage calculations (last 90 days)
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const { data: consumption } = await this.supabase
      .from('consumption_history')
      .select('product_id, quantity_used, created_at')
      .gte('created_at', ninetyDaysAgo.toISOString())

    // Get last inventory counts
    const { data: lastCounts } = await this.supabase
      .from('count_entries')
      .select('product_id, counted_quantity, created_at')
      .order('created_at', { ascending: false })

    // Get vendor catalog for names
    const { data: vendors } = await this.supabase
      .from('vendor_catalog')
      .select('id, name, code')

    // Build consumption map (product_id -> total quantity used in 90 days)
    const consumptionMap = new Map<string, number>()
    for (const c of consumption || []) {
      const current = consumptionMap.get(c.product_id) || 0
      consumptionMap.set(c.product_id, current + (c.quantity_used || 0))
    }

    // Build last count map
    const lastCountMap = new Map<string, { qty: number; date: string }>()
    for (const count of lastCounts || []) {
      if (!lastCountMap.has(count.product_id)) {
        lastCountMap.set(count.product_id, {
          qty: count.counted_quantity,
          date: count.created_at
        })
      }
    }

    // Build vendor map
    const vendorMap = new Map<string, { name: string; code: string }>()
    for (const v of vendors || []) {
      vendorMap.set(v.id, { name: v.name, code: v.code })
    }

    // Generate reorder items
    const items: ReorderItem[] = []

    for (const product of filteredProducts) {
      const totalUsed90Days = consumptionMap.get(product.id) || 0
      const avgDailyUsage = totalUsed90Days / 90
      const avgWeeklyUsage = avgDailyUsage * 7

      // Get stock data from inventory_stock join (filter to this shop)
      const stockRecords = Array.isArray(product.stock) ? product.stock : (product.stock ? [product.stock] : [])
      const stockRow = stockRecords.find((s: any) => s.shop_id === companyId) || stockRecords[0]

      const currentStock = stockRow?.quantity_on_hand ?? product.quantity_on_hand ?? 0
      // Use inventory_stock reorder_point if > 0, else product-level, else company preset
      const stockReorderPoint = stockRow?.reorder_point ?? 0
      const reorderPoint = stockReorderPoint > 0
        ? stockReorderPoint
        : presets.default_reorder_point
      // Par level = reorder point + order quantity (enough to cover until next delivery)
      const stockReorderQty = stockRow?.reorder_quantity ?? 0
      const orderQty = stockReorderQty > 0 ? stockReorderQty : presets.default_order_quantity
      const parLevel = reorderPoint + orderQty

      // Calculate days of stock remaining
      const daysOfStockRemaining = avgDailyUsage > 0
        ? Math.round(currentStock / avgDailyUsage)
        : currentStock > 0 ? 999 : 0

      // Get supplier info
      const supplierInfo = product.supplier?.[0]
      const leadTimeDays = supplierInfo?.lead_time_days || 7
      const vendorInfo = supplierInfo?.supplier_id
        ? vendorMap.get(supplierInfo.supplier_id)
        : null

      // Determine priority
      const effectiveLeadTime = leadTimeDays + settings.leadTimeSafetyBuffer
      let priority: 'critical' | 'urgent' | 'normal' | 'optional'
      let priorityReason: string

      if (currentStock <= 0) {
        priority = 'critical'
        priorityReason = 'Out of stock'
      } else if (daysOfStockRemaining <= settings.criticalThresholdDays) {
        priority = 'critical'
        priorityReason = `Only ${daysOfStockRemaining} days of stock (≤${settings.criticalThresholdDays})`
      } else if (daysOfStockRemaining <= settings.urgentThresholdDays) {
        priority = 'urgent'
        priorityReason = `${daysOfStockRemaining} days of stock (≤${settings.urgentThresholdDays})`
      } else if (currentStock <= reorderPoint) {
        priority = 'normal'
        priorityReason = `Below reorder point (${currentStock} ≤ ${reorderPoint})`
      } else if (daysOfStockRemaining <= effectiveLeadTime) {
        priority = 'normal'
        priorityReason = `Stock covers ${daysOfStockRemaining} days, lead time is ${effectiveLeadTime} days`
      } else {
        priority = 'optional'
        priorityReason = 'Adequate stock level'
      }

      // Skip optional items if not requested
      if (priority === 'optional' && !settings.includeOptional) {
        continue
      }

      // Apply filters
      if (options.categoryFilter?.length && !options.categoryFilter.includes(product.category)) {
        continue
      }
      if (options.priorityFilter?.length && !options.priorityFilter.includes(priority)) {
        continue
      }

      // Calculate suggested order quantity
      const orderMultiple = product.order_multiple || presets.order_multiple || 1
      const minOrderQty = product.min_order_qty || 1

      // Order enough to cover until the next delivery + safety stock
      // daysBetweenDeliveries accounts for the shop's delivery schedule
      let suggestedQty: number

      if (avgDailyUsage > 0) {
        // Usage-based: order enough for the delivery cycle + safety
        const usageTilNextDelivery = avgDailyUsage * daysBetweenDeliveries
        const safetyQty = avgDailyUsage * presets.safety_stock_days
        suggestedQty = Math.ceil(usageTilNextDelivery + safetyQty) - currentStock
        // At minimum, order the default order quantity
        suggestedQty = Math.max(suggestedQty, presets.default_order_quantity)
      } else {
        // No usage data: order up to par level or default order qty
        suggestedQty = Math.max(parLevel - currentStock, presets.default_order_quantity)
      }

      suggestedQty = Math.max(suggestedQty, minOrderQty)

      // Round to order multiple
      if (orderMultiple > 1) {
        suggestedQty = Math.ceil(suggestedQty / orderMultiple) * orderMultiple
      }

      const unitCost = supplierInfo?.supplier_price || product.unit_cost || 0

      // Get last count date
      const lastCount = lastCountMap.get(product.id)

      items.push({
        id: `reorder-${product.id}`,
        productId: product.id,
        sku: product.sku || '',
        productName: product.name,
        category: product.category || 'Uncategorized',
        manufacturer: product.manufacturer || product.supplier || null,
        vendorCode: product.vendor_code || null,
        currentStock,
        reorderPoint,
        parLevel,
        unit: product.unit || 'each',
        suggestedOrderQty: Math.round(suggestedQty),
        minOrderQty,
        orderMultiple,
        unitCost,
        extendedCost: Math.round(suggestedQty * unitCost * 100) / 100,
        supplierId: supplierInfo?.supplier_id || null,
        supplierName: vendorInfo?.name || null,
        supplierSku: supplierInfo?.supplier_sku || null,
        leadTimeDays,
        avgDailyUsage: Math.round(avgDailyUsage * 100) / 100,
        avgWeeklyUsage: Math.round(avgWeeklyUsage * 100) / 100,
        daysOfStockRemaining,
        priority,
        priorityReason,
        lastOrderDate: product.last_order_date || null,
        lastCountDate: lastCount?.date || null,
        locationBin: product.location_bin || product.bin_location || null
      })
    }

    // Sort by priority then by days remaining
    const priorityOrder = { critical: 0, urgent: 1, normal: 2, optional: 3 }
    items.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (pDiff !== 0) return pDiff
      return a.daysOfStockRemaining - b.daysOfStockRemaining
    })

    // Calculate summary
    const summary = {
      totalItems: items.length,
      criticalItems: items.filter(i => i.priority === 'critical').length,
      urgentItems: items.filter(i => i.priority === 'urgent').length,
      normalItems: items.filter(i => i.priority === 'normal').length,
      optionalItems: items.filter(i => i.priority === 'optional').length,
      totalEstimatedCost: Math.round(items.reduce((sum, i) => sum + i.extendedCost, 0) * 100) / 100,
      totalSkusToOrder: items.filter(i => i.priority !== 'optional').length
    }

    return {
      generatedAt: new Date().toISOString(),
      companyId,
      companyName: company?.name || '',
      reportPeriod: `Based on 90-day consumption history · ${presets.deliveries_per_week}x/week delivery`,
      summary,
      items,
      settings,
      companyPresets: {
        defaultReorderPoint: presets.default_reorder_point,
        defaultOrderQuantity: presets.default_order_quantity,
        deliveriesPerWeek: presets.deliveries_per_week,
        deliverySchedule: presets.delivery_schedule,
        deliveryDays: presets.delivery_days || [],
        leadTimeDays: presets.lead_time_days,
        daysBetweenDeliveries: Math.round(daysBetweenDeliveries * 10) / 10,
        safetyStockDays: presets.safety_stock_days,
        maxInventoryDollars: presets.max_inventory_dollars,
        minInventoryDollars: presets.min_inventory_dollars,
      }
    }
  }

  // Generate CSV export
  generateCSV(report: ReorderReport): string {
    const headers = [
      'Priority',
      'SKU',
      'Product Name',
      'Category',
      'Bin Location',
      'Current Stock',
      'Reorder Point',
      'Par Level',
      'Unit',
      'Suggested Order Qty',
      'Unit Cost',
      'Extended Cost',
      'Supplier',
      'Supplier SKU',
      'Lead Time (Days)',
      'Avg Daily Usage',
      'Days of Stock',
      'Priority Reason',
      'Last Count Date'
    ]

    const rows = report.items.map(item => [
      item.priority.toUpperCase(),
      item.sku,
      `"${item.productName.replace(/"/g, '""')}"`,
      item.category,
      item.locationBin || '',
      item.currentStock,
      item.reorderPoint,
      item.parLevel,
      item.unit,
      item.suggestedOrderQty,
      item.unitCost.toFixed(2),
      item.extendedCost.toFixed(2),
      item.supplierName || '',
      item.supplierSku || '',
      item.leadTimeDays,
      item.avgDailyUsage,
      item.daysOfStockRemaining,
      `"${item.priorityReason}"`,
      item.lastCountDate ? new Date(item.lastCountDate).toLocaleDateString() : ''
    ])

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  }

  // Generate printable HTML for walk-around checklist
  generatePrintableHTML(report: ReorderReport): string {
    const priorityColors: Record<string, string> = {
      critical: '#dc2626',
      urgent: '#f59e0b',
      normal: '#3b82f6',
      optional: '#9ca3af'
    }

    const itemRows = report.items
      .filter(i => i.priority !== 'optional') // Only items needing action
      .map(item => `
        <tr class="${item.priority}">
          <td style="width: 30px;">
            <input type="checkbox" style="width: 20px; height: 20px;" />
          </td>
          <td>
            <span class="priority-badge" style="background: ${priorityColors[item.priority]}; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px;">
              ${item.priority.toUpperCase()}
            </span>
          </td>
          <td><strong>${item.sku}</strong></td>
          <td>${item.productName}</td>
          <td style="text-align: center;">${item.locationBin || '—'}</td>
          <td style="text-align: right;"><strong>${item.currentStock}</strong></td>
          <td style="text-align: right;">${item.reorderPoint}</td>
          <td style="text-align: right;">${item.parLevel}</td>
          <td style="text-align: right; background: #f3f4f6;"><strong>${item.suggestedOrderQty}</strong></td>
          <td style="text-align: right;">$${item.unitCost.toFixed(2)}</td>
          <td style="text-align: right;"><strong>$${item.extendedCost.toFixed(2)}</strong></td>
          <td style="font-size: 11px;">${item.supplierName || '—'}</td>
          <td style="width: 80px; border-bottom: 1px solid #000;"></td>
        </tr>
      `).join('')

    return `
<!DOCTYPE html>
<html>
<head>
  <title>Reorder Report - ${report.companyName}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
    h1 { font-size: 18px; margin-bottom: 5px; }
    .subtitle { color: #666; font-size: 11px; margin-bottom: 20px; }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; background: #f9fafb; padding: 15px; border-radius: 8px; }
    .summary-item { text-align: center; }
    .summary-value { font-size: 24px; font-weight: bold; }
    .summary-label { font-size: 10px; color: #666; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1f2937; color: white; padding: 8px 4px; text-align: left; font-size: 10px; }
    td { padding: 6px 4px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; }
    tr.critical td { background: #fef2f2; }
    tr.urgent td { background: #fffbeb; }
    .print-notes { margin-top: 30px; border-top: 2px solid #000; padding-top: 15px; }
    .print-notes h3 { margin-bottom: 10px; }
    .notes-line { border-bottom: 1px solid #ccc; height: 25px; margin-bottom: 5px; }
    @media print {
      body { margin: 10px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom: 20px;">
    <button onclick="window.print()" style="padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer;">
      🖨️ Print Report
    </button>
  </div>

  <h1>📦 Reorder Report</h1>
  <div class="subtitle">
    ${report.companyName} | Generated: ${new Date(report.generatedAt).toLocaleString()} | ${report.reportPeriod}
  </div>

  <div class="summary">
    <div class="summary-item">
      <div class="summary-value" style="color: #dc2626;">${report.summary.criticalItems}</div>
      <div class="summary-label">Critical</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color: #f59e0b;">${report.summary.urgentItems}</div>
      <div class="summary-label">Urgent</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color: #3b82f6;">${report.summary.normalItems}</div>
      <div class="summary-label">Normal</div>
    </div>
    <div class="summary-item">
      <div class="summary-value">${report.summary.totalSkusToOrder}</div>
      <div class="summary-label">Total to Order</div>
    </div>
    <div class="summary-item">
      <div class="summary-value" style="color: #059669;">$${report.summary.totalEstimatedCost.toLocaleString()}</div>
      <div class="summary-label">Est. Total Cost</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>✓</th>
        <th>Priority</th>
        <th>SKU</th>
        <th>Product Name</th>
        <th style="text-align: center;">Bin</th>
        <th style="text-align: right;">On Hand</th>
        <th style="text-align: right;">Min</th>
        <th style="text-align: right;">Par</th>
        <th style="text-align: right; background: #374151;">Order Qty</th>
        <th style="text-align: right;">Unit $</th>
        <th style="text-align: right;">Ext $</th>
        <th>Supplier</th>
        <th>Actual Count</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
    <tfoot>
      <tr style="background: #f3f4f6; font-weight: bold;">
        <td colspan="10"></td>
        <td style="text-align: right;">$${report.summary.totalEstimatedCost.toLocaleString()}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  <div class="print-notes">
    <h3>Notes / Adjustments:</h3>
    <div class="notes-line"></div>
    <div class="notes-line"></div>
    <div class="notes-line"></div>
    <div class="notes-line"></div>
  </div>

  <div style="margin-top: 30px; font-size: 10px; color: #666;">
    <strong>Walked by:</strong> _________________________
    <strong style="margin-left: 40px;">Date:</strong> _____________
    <strong style="margin-left: 40px;">Signature:</strong> _________________________
  </div>
</body>
</html>
    `
  }
}

// Factory function
export function createReorderReportService(supabase: SupabaseClient): ReorderReportService {
  return new ReorderReportService(supabase)
}

export default ReorderReportService
