import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Excel export for Calculation Verification Report
// Generates an XLSX file with full formula breakdown for client verification

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify super_admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const companyA = searchParams.get('companyA') || null
    const companyB = searchParams.get('companyB') || null

    // Call our own verification API internally to get data
    // Build the internal URL
    const baseUrl = request.nextUrl.origin
    const verifyParams = new URLSearchParams()
    if (companyA) verifyParams.set('companyA', companyA)
    if (companyB) verifyParams.set('companyB', companyB)

    // Fetch data from the verification endpoint by replicating its logic
    // (We can't easily call ourselves, so we replicate the core data fetching)
    const { data: allCompanies } = await supabase
      .from('companies')
      .select('id, name')
      .neq('name', 'System')
      .limit(100)

    if (!allCompanies || allCompanies.length === 0) {
      return NextResponse.json({ error: 'No companies found' }, { status: 404 })
    }

    const companiesToAnalyze: string[] = []
    if (companyA && companyB) {
      companiesToAnalyze.push(companyA, companyB)
    } else if (companyA) {
      companiesToAnalyze.push(companyA)
    } else {
      companiesToAnalyze.push(...allCompanies.slice(0, 2).map(c => c.id))
    }

    // Fetch settings
    const { data: settingsData } = await supabase
      .from('company_reorder_settings')
      .select('*')
      .in('company_id', companiesToAnalyze)

    interface CompanyCalcInfo {
      id: string
      name: string
      deliveriesPerWeek: number
      leadTimeDays: number
      safetyStockDays: number
      daysBetweenDeliveries: number
      reorderPoint: number
      defaultOrderQty: number
    }

    const companiesInfo: CompanyCalcInfo[] = []
    for (const compId of companiesToAnalyze) {
      const company = allCompanies.find(c => c.id === compId)
      const settings = settingsData?.find((s: any) => s.company_id === compId)
      const deliveriesPerWeek = settings?.deliveries_per_week || 2
      const daysBetweenDeliveries = 7 / deliveriesPerWeek

      companiesInfo.push({
        id: compId,
        name: company?.name || 'Unknown',
        deliveriesPerWeek,
        leadTimeDays: settings?.lead_time_days || 1,
        safetyStockDays: settings?.safety_stock_days || 2,
        daysBetweenDeliveries: Math.round(daysBetweenDeliveries * 100) / 100,
        reorderPoint: settings?.default_reorder_point || 3,
        defaultOrderQty: settings?.default_order_quantity || 4
      })
    }

    // Fetch consumption
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const { data: consumption } = await supabase
      .from('consumption_history')
      .select('product_id, quantity_used, created_at')
      .gte('created_at', ninetyDaysAgo.toISOString())

    const consumptionMap = new Map<string, number>()
    for (const c of consumption || []) {
      const current = consumptionMap.get(c.product_id) || 0
      consumptionMap.set(c.product_id, current + (c.quantity_used || 0))
    }

    // Fetch products
    const { data: products } = await supabase
      .from('products')
      .select(`
        id, sku, name, category, company_id, quantity_on_hand,
        stock:inventory_stock(quantity_on_hand, shop_id)
      `)
      .in('company_id', companiesToAnalyze)
      .eq('is_active', true)
      .order('sku')

    // Group by SKU
    const productsBySkuMap = new Map<string, any[]>()
    for (const product of products || []) {
      const sku = product.sku || 'unknown'
      if (!productsBySkuMap.has(sku)) {
        productsBySkuMap.set(sku, [])
      }
      productsBySkuMap.get(sku)!.push(product)
    }

    // Build CSV content (Excel-compatible with formulas shown)
    const now = new Date().toISOString().split('T')[0]
    const compNames = companiesInfo.map(c => c.name)

    // Build header row
    const headers = ['SKU', 'Product Name', 'Category']
    for (const c of companiesInfo) {
      headers.push(
        `${c.name} - Stock`,
        `${c.name} - 90d Usage`,
        `${c.name} - Avg Daily`,
        `${c.name} - Avg Weekly`,
        `${c.name} - Days Left`,
        `${c.name} - Order Qty`,
        `${c.name} - Priority`,
        `${c.name} - Reason`
      )
    }
    if (companiesInfo.length >= 2) {
      headers.push('Priority Match')
    }

    // Build data rows
    const rows: string[][] = []
    for (const [sku, productList] of Array.from(productsBySkuMap.entries())) {
      const baseProduct = productList[0]
      const row: string[] = [sku, baseProduct.name || '', baseProduct.category || '']
      const priorities: string[] = []

      for (const companyInfo of companiesInfo) {
        const product = productList.find((p: any) => p.company_id === companyInfo.id) || productList[0]
        const totalUsed90Days = consumptionMap.get(product.id) || 0

        let currentStock = product.quantity_on_hand || 0
        if (product.stock && Array.isArray(product.stock)) {
          const companyStock = product.stock.find((s: any) => s.shop_id === companyInfo.id)
          if (companyStock) currentStock = companyStock.quantity_on_hand || 0
        }

        const avgDailyUsage = totalUsed90Days / 90
        const avgWeeklyUsage = avgDailyUsage * 7
        const daysOfStockRemaining = avgDailyUsage > 0
          ? Math.round(currentStock / avgDailyUsage)
          : (currentStock > 0 ? 999 : 0)

        let suggestedQty: number
        if (avgDailyUsage > 0) {
          const usageTilNext = avgDailyUsage * companyInfo.daysBetweenDeliveries
          const safetyQty = avgDailyUsage * companyInfo.safetyStockDays
          suggestedQty = Math.ceil(usageTilNext + safetyQty) - currentStock
          suggestedQty = Math.max(suggestedQty, companyInfo.defaultOrderQty)
        } else {
          const parLevel = companyInfo.reorderPoint + companyInfo.defaultOrderQty
          suggestedQty = Math.max(parLevel - currentStock, companyInfo.defaultOrderQty)
        }
        suggestedQty = Math.max(suggestedQty, 1)

        const critThreshold = Math.max(1, Math.floor(companyInfo.daysBetweenDeliveries))
        const urgThreshold = Math.max(3, Math.ceil(companyInfo.daysBetweenDeliveries * 2))
        const effectiveLead = companyInfo.leadTimeDays + companyInfo.safetyStockDays

        let priority: string
        let reason: string
        if (currentStock <= 0) { priority = 'CRITICAL'; reason = 'Out of stock' }
        else if (daysOfStockRemaining <= critThreshold) { priority = 'CRITICAL'; reason = `${daysOfStockRemaining} days ≤ ${critThreshold}` }
        else if (daysOfStockRemaining <= urgThreshold) { priority = 'URGENT'; reason = `${daysOfStockRemaining} days ≤ ${urgThreshold}` }
        else if (currentStock <= companyInfo.reorderPoint) { priority = 'NORMAL'; reason = `Stock ${currentStock} ≤ reorder pt ${companyInfo.reorderPoint}` }
        else if (daysOfStockRemaining <= effectiveLead) { priority = 'NORMAL'; reason = `${daysOfStockRemaining} days ≤ lead ${effectiveLead}` }
        else { priority = 'OPTIONAL'; reason = 'Adequate stock' }

        priorities.push(priority)

        row.push(
          String(currentStock),
          String(Math.round(totalUsed90Days * 100) / 100),
          String(Math.round(avgDailyUsage * 100) / 100),
          String(Math.round(avgWeeklyUsage * 100) / 100),
          String(daysOfStockRemaining),
          String(Math.round(suggestedQty)),
          priority,
          reason
        )
      }

      if (companiesInfo.length >= 2) {
        row.push(priorities.every(p => p === priorities[0]) ? 'YES' : 'NO')
      }

      rows.push(row)
    }

    // Generate HTML table that Excel can open natively
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>
<x:ExcelWorksheet><x:Name>Calculation Verification</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
<x:ExcelWorksheet><x:Name>Settings</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
<x:ExcelWorksheet><x:Name>Formula Reference</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
  td, th { padding: 4px 8px; font-family: Arial; font-size: 11px; }
  th { background: #1f2937; color: white; font-weight: bold; }
  .match-yes { background: #d1fae5; color: #065f46; font-weight: bold; }
  .match-no { background: #fecaca; color: #991b1b; font-weight: bold; }
  .critical { background: #fef2f2; color: #991b1b; font-weight: bold; }
  .urgent { background: #fffbeb; color: #92400e; }
  .normal { background: #eff6ff; color: #1e40af; }
  .header-row { background: #f1f5f9; font-weight: bold; }
  .formula { font-family: monospace; background: #f8fafc; }
  .section-header { background: #1e40af; color: white; font-weight: bold; font-size: 13px; }
</style>
</head>
<body>
<table border="1" cellpadding="4" cellspacing="0">
<tr class="section-header"><td colspan="${headers.length}">RefinishAI — Calculation Verification Report | Generated: ${now}</td></tr>
<tr class="header-row"><td colspan="${headers.length}">Companies: ${compNames.join(' vs ')} | Total Products: ${rows.length}</td></tr>
<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`

    for (const row of rows) {
      const matchCell = row[row.length - 1]
      const matchClass = matchCell === 'YES' ? 'match-yes' : matchCell === 'NO' ? 'match-no' : ''

      html += '<tr>'
      for (let i = 0; i < row.length; i++) {
        const val = row[i]
        let cls = ''
        if (i === row.length - 1 && companiesInfo.length >= 2) {
          cls = matchClass
        } else if (val === 'CRITICAL') cls = 'critical'
        else if (val === 'URGENT') cls = 'urgent'
        else if (val === 'NORMAL') cls = 'normal'

        html += `<td class="${cls}">${val}</td>`
      }
      html += '</tr>'
    }

    html += '</table>'

    // Settings sheet
    html += `<br/><table border="1" cellpadding="4" cellspacing="0">
<tr class="section-header"><td colspan="3">Company Reorder Settings</td></tr>
<tr><th>Setting</th>${companiesInfo.map(c => `<th>${c.name}</th>`).join('')}</tr>
<tr><td>Deliveries/Week</td>${companiesInfo.map(c => `<td>${c.deliveriesPerWeek}</td>`).join('')}</tr>
<tr><td>Lead Time (days)</td>${companiesInfo.map(c => `<td>${c.leadTimeDays}</td>`).join('')}</tr>
<tr><td>Safety Stock (days)</td>${companiesInfo.map(c => `<td>${c.safetyStockDays}</td>`).join('')}</tr>
<tr><td>Days Between Deliveries</td>${companiesInfo.map(c => `<td>${c.daysBetweenDeliveries}</td>`).join('')}</tr>
<tr><td>Reorder Point</td>${companiesInfo.map(c => `<td>${c.reorderPoint}</td>`).join('')}</tr>
<tr><td>Default Order Qty</td>${companiesInfo.map(c => `<td>${c.defaultOrderQty}</td>`).join('')}</tr>
</table>`

    // Formula reference sheet
    html += `<br/><table border="1" cellpadding="4" cellspacing="0">
<tr class="section-header"><td colspan="2">Formula Reference</td></tr>
<tr><th>Metric</th><th>Formula</th></tr>
<tr><td>Avg Daily Usage</td><td class="formula">totalUsed90Days / 90</td></tr>
<tr><td>Avg Weekly Usage</td><td class="formula">avgDailyUsage × 7</td></tr>
<tr><td>Days Between Deliveries</td><td class="formula">7 / deliveries_per_week</td></tr>
<tr><td>Days of Stock Remaining</td><td class="formula">IF avgDailyUsage > 0: ROUND(currentStock / avgDailyUsage) ELSE IF stock > 0: 999 ELSE: 0</td></tr>
<tr><td>Suggested Order Qty</td><td class="formula">CEIL(avgDailyUsage × daysBetweenDeliveries + avgDailyUsage × safetyStockDays) - currentStock, then MAX(result, defaultOrderQty)</td></tr>
<tr><td>Critical Threshold</td><td class="formula">MAX(1, FLOOR(daysBetweenDeliveries))</td></tr>
<tr><td>Urgent Threshold</td><td class="formula">MAX(3, CEIL(daysBetweenDeliveries × 2))</td></tr>
<tr><td>Effective Lead Time</td><td class="formula">leadTimeDays + safetyStockDays</td></tr>
<tr><td>Priority: CRITICAL</td><td class="formula">stock = 0 OR daysOfStock ≤ criticalThreshold</td></tr>
<tr><td>Priority: URGENT</td><td class="formula">daysOfStock ≤ urgentThreshold</td></tr>
<tr><td>Priority: NORMAL</td><td class="formula">stock ≤ reorderPoint OR daysOfStock ≤ effectiveLeadTime</td></tr>
<tr><td>Priority: OPTIONAL</td><td class="formula">All other cases (adequate stock)</td></tr>
</table>

</body></html>`

    // Return as downloadable Excel file
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.ms-excel',
        'Content-Disposition': `attachment; filename="RefinishAI_Calculation_Verification_${now}.xls"`,
      }
    })

  } catch (error: any) {
    console.error('Calculation verify export error:', error)
    return NextResponse.json(
      { error: 'Export failed', details: error.message },
      { status: 500 }
    )
  }
}
