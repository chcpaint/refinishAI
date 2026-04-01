'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  TrendingUp, TrendingDown, DollarSign, Package, AlertTriangle,
  CheckCircle, RefreshCw, Calendar, Target, Lightbulb, BarChart3,
  PieChart, Activity, Zap, ArrowUp, ArrowDown, Minus,
  FileText, Download, Printer, Filter, Search,
  ChevronDown, ChevronUp, ArrowUpDown, ClipboardList, Users, X
} from 'lucide-react'
import { createCostProjectionEngine } from '@/lib/ai/cost-projection'
import type { CostProjection, WasteAnalysis, ConsumptionPattern } from '@/lib/ai/cost-projection'
import { createInventoryReportService } from '@/lib/reports/inventory-report'
import type { InventoryReport } from '@/lib/reports/inventory-report'
import type { InventoryReportFilters, InventoryReportItem } from '@/lib/types'

type TopTab = 'analytics' | 'reports'
type ReportTab = 'inventory' | 'yoy' | 'counts' | 'adjustments'
type SortField = 'sku' | 'name' | 'quantityOnHand' | 'totalValue' | 'status' | 'qtyChange' | 'pctChange'
type SortDir = 'asc' | 'desc'

function getDefaultStartDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().split('T')[0]
}

export default function AnalyticsReportsPage() {
  const supabase = createClient()
  const searchParams = useSearchParams()

  // Shared state
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState('staff')
  const initialTab = (searchParams.get('tab') === 'reports' ? 'reports' : 'analytics') as TopTab
  const [topTab, setTopTab] = useState<TopTab>(initialTab)

  // ─── ANALYTICS STATE ───
  const [projectionPeriod, setProjectionPeriod] = useState(4)
  const [projection, setProjection] = useState<CostProjection | null>(null)
  const [wasteAnalysis, setWasteAnalysis] = useState<WasteAnalysis | null>(null)
  const [patterns, setPatterns] = useState<ConsumptionPattern[]>([])
  const [refreshing, setRefreshing] = useState(false)

  // ─── REPORTS STATE ───
  const [reportLoading, setReportLoading] = useState(false)
  const [report, setReport] = useState<InventoryReport | null>(null)
  const [manufacturerOptions, setManufacturerOptions] = useState<string[]>([])
  const [categoryOptions, setCategoryOptions] = useState<string[]>([])
  const [lineOptions, setLineOptions] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(true)
  const [filters, setFilters] = useState<InventoryReportFilters>({
    startDate: getDefaultStartDate(),
    endDate: new Date().toISOString().split('T')[0],
    itemSearch: '',
    manufacturer: '',
    category: '',
    productLine: '',
    enableYoY: false
  })
  const [activeReportTab, setActiveReportTab] = useState<ReportTab>('inventory')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set())

  // ─── INITIALIZATION ───
  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    if (companyId) loadAnalytics()
  }, [projectionPeriod, companyId])

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('company_id, role')
        .eq('id', user.id)
        .single()

      if (profile?.company_id) {
        setCompanyId(profile.company_id)
        setUserRole(profile.role || 'staff')

        // Load report filter options
        const service = createInventoryReportService(supabase)
        const options = await service.getFilterOptions(profile.company_id)
        setManufacturerOptions(options.manufacturers)
        setCategoryOptions(options.categories)
        setLineOptions(options.productLines)

        // Generate initial report
        await generateReport(profile.company_id, filters)
      }
    } catch (err) {
      console.error('Failed to load initial data:', err)
    } finally {
      setLoading(false)
    }
  }

  // ─── ANALYTICS FUNCTIONS ───
  const loadAnalytics = async () => {
    if (!companyId) return
    try {
      const engine = createCostProjectionEngine(supabase)
      const [proj, waste, consumptionPatterns] = await Promise.all([
        engine.generateProjection(companyId, projectionPeriod),
        engine.analyzeWaste(companyId, 30),
        engine.analyzeConsumptionPatterns(companyId)
      ])
      setProjection('insufficient_data' in proj ? null : proj)
      setWasteAnalysis(waste)
      setPatterns(consumptionPatterns.slice(0, 10))
    } catch (error) {
      console.error('Error loading analytics:', error)
    }
  }

  const refreshData = async () => {
    setRefreshing(true)
    await loadAnalytics()
    setRefreshing(false)
  }

  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up': return <ArrowUp className="w-4 h-4 text-red-500" />
      case 'down': return <ArrowDown className="w-4 h-4 text-green-500" />
      default: return <Minus className="w-4 h-4 text-gray-400" />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-700 border-red-200'
      case 'medium': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      default: return 'bg-blue-100 text-blue-700 border-blue-200'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'order': return <Package className="w-5 h-5" />
      case 'warning': return <AlertTriangle className="w-5 h-5" />
      case 'opportunity': return <Lightbulb className="w-5 h-5" />
      default: return <CheckCircle className="w-5 h-5" />
    }
  }

  // ─── REPORTS FUNCTIONS ───
  async function generateReport(cId: string, f: InventoryReportFilters) {
    setReportLoading(true)
    try {
      const service = createInventoryReportService(supabase)
      const data = await service.generateReport(cId, f)
      setReport(data)
    } catch (err) {
      console.error('Failed to generate report:', err)
    } finally {
      setReportLoading(false)
    }
  }

  function handleApplyFilters() {
    if (companyId) generateReport(companyId, filters)
  }

  function handleResetFilters() {
    const reset: InventoryReportFilters = {
      startDate: getDefaultStartDate(),
      endDate: new Date().toISOString().split('T')[0],
      itemSearch: '',
      manufacturer: '',
      category: '',
      productLine: '',
      enableYoY: false
    }
    setFilters(reset)
    if (companyId) generateReport(companyId, reset)
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  function getSortedItems(): InventoryReportItem[] {
    if (!report) return []
    const items = [...report.items]
    items.sort((a, b) => {
      let valA: any = a[sortField as keyof InventoryReportItem]
      let valB: any = b[sortField as keyof InventoryReportItem]
      if (typeof valA === 'string') valA = valA.toLowerCase()
      if (typeof valB === 'string') valB = valB.toLowerCase()
      if (valA == null) valA = ''
      if (valB == null) valB = ''
      if (valA < valB) return sortDir === 'asc' ? -1 : 1
      if (valA > valB) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }

  function exportCSV() {
    if (!report) return
    const service = createInventoryReportService(supabase)
    const csv = service.generateCSV(report)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `inventory-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function printReport() {
    if (!report) return
    const service = createInventoryReportService(supabase)
    const html = service.generatePrintableHTML(report)
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(html)
      printWindow.document.close()
    }
  }

  function toggleUser(userId: string) {
    const next = new Set(expandedUsers)
    if (next.has(userId)) { next.delete(userId) } else { next.add(userId) }
    setExpandedUsers(next)
  }

  function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
      critical: { bg: 'bg-red-100', text: 'text-red-700', label: 'Critical' },
      low: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Low' },
      adequate: { bg: 'bg-green-100', text: 'text-green-700', label: 'Adequate' },
      overstocked: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Overstocked' }
    }
    const c = config[status] || config.adequate
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
        {c.label}
      </span>
    )
  }

  function SortHeader({ field, label, align }: { field: SortField; label: string; align?: string }) {
    return (
      <th
        className={`py-3 px-3 text-xs font-semibold text-gray-600 cursor-pointer hover:text-gray-900 select-none uppercase tracking-wider ${align === 'right' ? 'text-right' : 'text-left'}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortField === field && (
            sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
          )}
        </span>
      </th>
    )
  }

  // ─── LOADING STATE ───
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  const sortedItems = getSortedItems()

  const reportTabs: { id: ReportTab; label: string; icon: any }[] = [
    { id: 'inventory', label: 'Inventory Detail', icon: Package },
    { id: 'yoy', label: 'Year-on-Year', icon: BarChart3 },
    { id: 'counts', label: 'Count History', icon: ClipboardList },
    { id: 'adjustments', label: 'Adjustments by User', icon: Users }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Analytics & Reports</h1>
              <p className="text-slate-300 mt-1 text-sm">Projections, waste analysis, and inventory reporting</p>
            </div>
          </div>
        </div>
      </div>

      {/* Top-Level Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-4 border-b border-gray-200 flex gap-0">
          <button
            onClick={() => setTopTab('analytics')}
            className={`flex items-center gap-2 transition-colors ${
              topTab === 'analytics' ? 'bg-white text-blue-700 font-semibold border-b-2 border-blue-600 px-4 py-3 text-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 px-4 py-3 text-sm font-medium'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Analytics & Projections
          </button>
          <button
            onClick={() => setTopTab('reports')}
            className={`flex items-center gap-2 transition-colors ${
              topTab === 'reports' ? 'bg-white text-blue-700 font-semibold border-b-2 border-blue-600 px-4 py-3 text-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 px-4 py-3 text-sm font-medium'
            }`}
          >
            <FileText className="w-4 h-4" />
            Inventory Reports
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* ANALYTICS TAB */}
      {/* ═══════════════════════════════════════════ */}
      {topTab === 'analytics' && (
        <div className="space-y-6">
          {/* Analytics Controls */}
          <div className="flex items-center justify-end gap-4">
            <select
              value={projectionPeriod}
              onChange={(e) => setProjectionPeriod(parseInt(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value={2}>2 Week Forecast</option>
              <option value={4}>4 Week Forecast</option>
              <option value={8}>8 Week Forecast</option>
              <option value={12}>12 Week Forecast</option>
            </select>
            <button
              onClick={refreshData}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Confidence Score */}
          {projection && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-6 py-3.5 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Confidence Score</h2>
              </div>
              <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="w-5 h-5 text-blue-600" />
                  <span className="font-medium text-gray-900">AI Confidence Score</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        projection.confidence >= 70 ? 'bg-green-500' :
                        projection.confidence >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${projection.confidence}%` }}
                    />
                  </div>
                  <span className="font-bold text-gray-900">{projection.confidence}%</span>
                </div>
              </div>
                <p className="text-sm text-gray-500 mt-2">
                  {projection.confidence >= 70
                    ? 'High confidence based on sufficient historical data'
                    : projection.confidence >= 40
                    ? 'Moderate confidence - more data will improve accuracy'
                    : 'Low confidence - add more historical invoices and consumption records'
                  }
                </p>
              </div>
            </div>
          )}

          {/* Key Metrics */}
          {projection && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Projected Jobs</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">{projection.estimatedJobs}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-3">Next {projectionPeriod} weeks</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Material Cost</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">${projection.projectedMaterialCost.toLocaleString()}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                    <Package className="w-6 h-6 text-green-600" />
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-3">Estimated spend</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Labor Cost</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">${projection.projectedLaborCost.toLocaleString()}</p>
                  </div>
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                    <Activity className="w-6 h-6 text-purple-600" />
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-3">Estimated spend</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Projected</p>
                    <p className="text-3xl font-bold text-blue-600 mt-1">${projection.projectedTotalCost.toLocaleString()}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <DollarSign className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
                <p className="text-sm text-gray-500 mt-3">Combined costs</p>
              </div>
            </div>
          )}

          {/* Category Breakdown + Waste Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {projection && projection.breakdown.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gray-50 px-6 py-3.5 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-blue-600" />
                    Cost Breakdown by Category
                  </h2>
                </div>
                <div className="p-6">
                  <div className="space-y-4">
                  {projection.breakdown.map((item, index) => (
                    <div key={item.category} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{item.category}</span>
                          {getTrendIcon(item.trend)}
                          <span className={`text-xs ${
                            item.trend === 'up' ? 'text-red-600' :
                            item.trend === 'down' ? 'text-green-600' : 'text-gray-500'
                          }`}>{item.trendPercent}%</span>
                        </div>
                        <span className="font-semibold text-gray-900">${item.projectedCost.toLocaleString()}</span>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${item.percentOfTotal}%`,
                          backgroundColor: `hsl(${220 - index * 30}, 70%, 50%)`
                        }} />
                      </div>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{item.projectedQuantity} units</span>
                        <span>{item.percentOfTotal}% of total</span>
                      </div>
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            )}

            {wasteAnalysis && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="bg-gray-50 px-6 py-3.5 border-b border-gray-200">
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                    <Target className="w-5 h-5 text-orange-600" />
                    Waste Analysis
                  </h2>
                </div>
                <div className="p-6">
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-orange-50 rounded-lg p-4">
                    <p className="text-sm text-orange-700">Waste Rate</p>
                    <p className="text-2xl font-bold text-orange-600">{wasteAnalysis.wastePercent}%</p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4">
                    <p className="text-sm text-red-700">Waste Cost</p>
                    <p className="text-2xl font-bold text-red-600">${wasteAnalysis.wasteCost.toLocaleString()}</p>
                  </div>
                </div>
                <div className="space-y-3 mb-6">
                  {wasteAnalysis.byCategory.slice(0, 5).map((item) => (
                    <div key={item.category} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{item.category}</p>
                        <p className="text-sm text-gray-500">{item.waste.toFixed(1)} units wasted</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold ${item.wastePercent > 20 ? 'text-red-600' : 'text-orange-600'}`}>{item.wastePercent}%</p>
                        <p className="text-sm text-gray-500">${item.wasteCost.toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                  </div>
                  <div className="border-t border-gray-200 pt-4">
                    <p className="text-sm font-medium text-gray-700 mb-3">6-Month Waste Trend</p>
                    <div className="flex items-end justify-between h-24 gap-2">
                      {wasteAnalysis.trends.map((trend) => (
                        <div key={trend.month} className="flex-1 flex flex-col items-center">
                          <div className="w-full bg-orange-200 rounded-t" style={{ height: `${trend.wastePercent * 4}px` }} />
                          <p className="text-xs text-gray-500 mt-1">{trend.month}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* AI Recommendations */}
          {projection && projection.recommendations.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-6 py-3.5 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-yellow-500" />
                  AI Recommendations
                </h2>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {projection.recommendations.map((rec, index) => (
                  <div key={index} className={`p-4 rounded-lg border ${getPriorityColor(rec.priority)}`}>
                    <div className="flex items-start gap-3">
                      {getTypeIcon(rec.type)}
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">{rec.title}</h3>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/50 capitalize">{rec.priority}</span>
                        </div>
                        <p className="text-sm mt-1 opacity-80">{rec.description}</p>
                        {rec.potentialSavings && (
                          <p className="text-sm font-medium mt-2">Potential Savings: ${rec.potentialSavings.toLocaleString()}</p>
                        )}
                        {rec.action && (
                          <button className="text-sm font-medium mt-2 underline">{rec.action} →</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </div>
          )}

          {/* Top Consumption Patterns */}
          {patterns.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-6 py-3.5 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                  Top Products by Consumption
                </h2>
              </div>
              <div className="p-6">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-100 border-b border-gray-200">
                      <tr>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Product</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Daily Avg</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Weekly Avg</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Monthly Avg</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Peak Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {patterns.map((pattern) => (
                      <tr key={pattern.productId} className="border-b border-gray-100">
                        <td className="py-3 px-4 font-medium text-gray-900">{pattern.productName}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{pattern.avgDailyUsage}</td>
                        <td className="py-3 px-4 text-right text-gray-600">{pattern.avgWeeklyUsage}</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-900">{pattern.avgMonthlyUsage}</td>
                        <td className="py-3 px-4 text-gray-600">{pattern.peakDay} ({pattern.peakUsage})</td>
                      </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Waste Reduction Suggestions */}
          {wasteAnalysis && wasteAnalysis.suggestions.length > 0 && (
            <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg border border-green-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Waste Reduction Tips
              </h2>
              <ul className="space-y-3">
                {wasteAnalysis.suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <span className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center text-sm flex-shrink-0">{index + 1}</span>
                    <span className="text-gray-700">{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* No Data */}
          {!projection && !loading && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-12 text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Analytics Data Yet</h3>
              <p className="text-gray-600 mb-4">Upload invoices and track material consumption to generate cost projections and insights.</p>
              <a href="/dashboard/upload" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Upload Data</a>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* REPORTS TAB */}
      {/* ═══════════════════════════════════════════ */}
      {topTab === 'reports' && (
        <div className="space-y-6">
          {/* Reports Header Actions */}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                showFilters ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filters
            </button>
            <button
              onClick={exportCSV}
              disabled={!report}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button
              onClick={printReport}
              disabled={!report}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-5 py-3 border-b border-gray-200"><h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Filters</h3></div>
              <div className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                  <input type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                  <input type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Search Item</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" placeholder="Search by SKU or product name..." value={filters.itemSearch}
                      onChange={e => setFilters({ ...filters, itemSearch: e.target.value })}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
                  <select value={filters.manufacturer} onChange={e => setFilters({ ...filters, manufacturer: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                    <option value="">All Manufacturers</option>
                    {manufacturerOptions.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                    <option value="">All Categories</option>
                    {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Product Line</label>
                  <select value={filters.productLine} onChange={e => setFilters({ ...filters, productLine: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                    <option value="">All Lines</option>
                    {lineOptions.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={filters.enableYoY} onChange={e => setFilters({ ...filters, enableYoY: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  Enable Year-on-Year Comparison
                </label>
                <div className="flex items-center gap-2">
                  <button onClick={handleResetFilters} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">Reset</button>
                  <button onClick={handleApplyFilters} disabled={reportLoading}
                    className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {reportLoading ? 'Generating...' : 'Apply Filters'}
                  </button>
                </div>
              </div>
            </div>
            </div>
          )}

          {/* Summary Cards */}
          {report && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-4">
                <div className="flex items-center gap-2 mb-1"><Package className="w-4 h-4 text-gray-400" /><p className="text-xs font-medium text-gray-500">Total SKUs</p></div>
                <p className="text-2xl font-bold text-gray-900">{report.summary.totalSKUs}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-4">
                <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-green-500" /><p className="text-xs font-medium text-gray-500">Inventory Value</p></div>
                <p className="text-2xl font-bold text-gray-900">${report.summary.totalInventoryValue.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-4">
                <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-red-500" /><p className="text-xs font-medium text-gray-500">Critical Items</p></div>
                <p className="text-2xl font-bold text-red-600">{report.summary.criticalItems}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-4">
                <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-amber-500" /><p className="text-xs font-medium text-gray-500">Low Stock</p></div>
                <p className="text-2xl font-bold text-amber-600">{report.summary.lowStockItems}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-4">
                <div className="flex items-center gap-2 mb-1"><ClipboardList className="w-4 h-4 text-blue-500" /><p className="text-xs font-medium text-gray-500">Counts Completed</p></div>
                <p className="text-2xl font-bold text-gray-900">{report.summary.countsCompleted}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-4">
                <div className="flex items-center gap-2 mb-1"><ArrowUpDown className="w-4 h-4 text-purple-500" /><p className="text-xs font-medium text-gray-500">Net Adjustments</p></div>
                <p className={`text-2xl font-bold ${report.summary.netAdjustmentValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>${Math.abs(report.summary.netAdjustmentValue).toLocaleString()}</p>
              </div>
            </div>
          )}

          {/* Report Tabs */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gray-50 px-4 border-b border-gray-200 flex gap-0">
              {reportTabs.map(tab => {
                const Icon = tab.icon
                return (
                  <button key={tab.id} onClick={() => setActiveReportTab(tab.id)}
                    className={`flex items-center gap-2 transition-colors ${
                      activeReportTab === tab.id
                        ? 'bg-white text-blue-700 font-semibold border-b-2 border-blue-600 px-5 py-3 text-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 px-5 py-3 text-sm font-medium'
                    }`}
                  >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                  </button>
                )
              })}
            </div>

            <div className="p-0">
              {/* Inventory Detail */}
              {activeReportTab === 'inventory' && (
                <div className="overflow-x-auto">
                  {reportLoading ? (
                    <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
                  ) : sortedItems.length === 0 ? (
                    <div className="text-center py-12"><Package className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No inventory items match the current filters</p></div>
                  ) : (
                    <table className="w-full">
                      <thead className="bg-slate-100 border-b border-gray-200">
                        <tr>
                          <SortHeader field="sku" label="SKU" />
                          <SortHeader field="name" label="Product Name" />
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Category</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Manufacturer</th>
                          <SortHeader field="quantityOnHand" label="On Hand" align="right" />
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Unit Cost</th>
                          <SortHeader field="totalValue" label="Total Value" align="right" />
                          <SortHeader field="status" label="Status" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedItems.map(item => (
                          <tr key={item.productId} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-3 text-sm font-mono text-gray-700">{item.sku}</td>
                            <td className="py-3 px-3 text-sm text-gray-900 font-medium">{item.name}</td>
                            <td className="py-3 px-3 text-sm text-gray-600">{item.category}</td>
                            <td className="py-3 px-3 text-sm text-gray-600">{item.manufacturer || '—'}</td>
                            <td className="py-3 px-3 text-sm text-right font-medium text-gray-900">{item.quantityOnHand}</td>
                            <td className="py-3 px-3 text-sm text-right text-gray-600">${item.unitCost.toFixed(2)}</td>
                            <td className="py-3 px-3 text-sm text-right font-medium text-gray-900">${item.totalValue.toFixed(2)}</td>
                            <td className="py-3 px-3"><StatusBadge status={item.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-100 border-t border-gray-200">
                        <tr>
                          <td colSpan={5} className="py-3 px-3 text-sm font-semibold text-gray-600 uppercase tracking-wider">Totals</td>
                          <td className="py-3 px-3 text-sm text-right font-bold text-gray-900">{report?.summary.totalQuantity.toLocaleString()}</td>
                          <td className="py-3 px-3"></td>
                          <td className="py-3 px-3 text-sm text-right font-bold text-gray-900">${report?.summary.totalInventoryValue.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}

              {/* Year-on-Year */}
              {activeReportTab === 'yoy' && (
                <div className="overflow-x-auto">
                  {!filters.enableYoY ? (
                    <div className="text-center py-12"><BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500 mb-2">Year-on-Year comparison is disabled</p><p className="text-sm text-gray-400">Enable it in the Filters panel above, then click Apply Filters</p></div>
                  ) : sortedItems.length === 0 ? (
                    <div className="text-center py-12"><BarChart3 className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No data available for comparison</p></div>
                  ) : (
                    <table className="w-full">
                      <thead className="bg-slate-100 border-b border-gray-200">
                        <tr>
                          <SortHeader field="sku" label="SKU" />
                          <SortHeader field="name" label="Product Name" />
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Current Qty</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Current Value</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Prior Yr Qty</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Prior Yr Value</th>
                          <SortHeader field="qtyChange" label="Qty Change" align="right" />
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Value Change</th>
                          <SortHeader field="pctChange" label="% Change" align="right" />
                        </tr>
                      </thead>
                      <tbody>
                        {sortedItems.map(item => {
                          const changeColor = (item.qtyChange || 0) > 0 ? 'text-green-600' : (item.qtyChange || 0) < 0 ? 'text-red-600' : 'text-gray-500'
                          const ChangeIcon = (item.qtyChange || 0) > 0 ? TrendingUp : (item.qtyChange || 0) < 0 ? TrendingDown : Minus
                          return (
                            <tr key={item.productId} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-3 text-sm font-mono text-gray-700">{item.sku}</td>
                              <td className="py-3 px-3 text-sm text-gray-900 font-medium">{item.name}</td>
                              <td className="py-3 px-3 text-sm text-right font-medium text-gray-900">{item.quantityOnHand}</td>
                              <td className="py-3 px-3 text-sm text-right text-gray-900">${item.totalValue.toFixed(2)}</td>
                              <td className="py-3 px-3 text-sm text-right text-gray-500">{item.priorYearQty ?? '—'}</td>
                              <td className="py-3 px-3 text-sm text-right text-gray-500">{item.priorYearValue != null ? `$${item.priorYearValue.toFixed(2)}` : '—'}</td>
                              <td className={`py-3 px-3 text-sm text-right font-medium ${changeColor}`}>
                                <span className="inline-flex items-center gap-1"><ChangeIcon className="w-3 h-3" />{item.qtyChange != null ? (item.qtyChange >= 0 ? '+' : '') + item.qtyChange : '—'}</span>
                              </td>
                              <td className={`py-3 px-3 text-sm text-right font-medium ${changeColor}`}>{item.valueChange != null ? (item.valueChange >= 0 ? '+$' : '-$') + Math.abs(item.valueChange).toFixed(2) : '—'}</td>
                              <td className={`py-3 px-3 text-sm text-right font-medium ${changeColor}`}>{item.pctChange != null ? (item.pctChange >= 0 ? '+' : '') + item.pctChange + '%' : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Count History */}
              {activeReportTab === 'counts' && (
                <div className="overflow-x-auto">
                  {!report?.countHistory?.length ? (
                    <div className="text-center py-12"><ClipboardList className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No completed counts in this date range</p></div>
                  ) : (
                    <table className="w-full">
                      <thead className="bg-slate-100 border-b border-gray-200">
                        <tr>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Date</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Type</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Status</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Items Counted</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Variances</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Variance Value</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Counted By</th>
                          <th className="py-3 px-3 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Verified By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.countHistory.map(c => (
                          <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-3 px-3 text-sm text-gray-900 font-medium">{new Date(c.countDate).toLocaleDateString()}</td>
                            <td className="py-3 px-3 text-sm text-gray-600 capitalize">{c.countType.replace('_', ' ')}</td>
                            <td className="py-3 px-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                <CheckCircle className="w-3 h-3 mr-1" />{c.status}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-sm text-right text-gray-900 font-medium">{c.itemsCounted}</td>
                            <td className="py-3 px-3 text-sm text-right text-gray-900">{c.varianceCount > 0 ? <span className="text-amber-600 font-medium">{c.varianceCount}</span> : <span className="text-green-600">0</span>}</td>
                            <td className={`py-3 px-3 text-sm text-right font-medium ${c.totalVarianceValue !== 0 ? 'text-amber-600' : 'text-green-600'}`}>${Math.abs(c.totalVarianceValue).toFixed(2)}</td>
                            <td className="py-3 px-3 text-sm text-gray-700">{c.countedByName}</td>
                            <td className="py-3 px-3 text-sm text-gray-500">{c.verifiedByName || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Adjustments by User */}
              {activeReportTab === 'adjustments' && (
                <div>
                  {!report?.userAdjustments?.length ? (
                    <div className="text-center py-12"><Users className="w-12 h-12 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">No adjustments recorded in this date range</p></div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {report.userAdjustments.map(user => (
                        <div key={user.userId}>
                          <button onClick={() => toggleUser(user.userId)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                                <span className="text-sm font-bold text-blue-700">{user.userName.charAt(0).toUpperCase()}</span>
                              </div>
                              <div className="text-left">
                                <p className="text-sm font-semibold text-gray-900">{user.userName}</p>
                                <p className="text-xs text-gray-500">{user.adjustmentCount} adjustment{user.adjustmentCount !== 1 ? 's' : ''}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={`text-lg font-bold ${user.totalValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>${Math.abs(user.totalValue).toLocaleString()}</span>
                              {expandedUsers.has(user.userId) ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                            </div>
                          </button>
                          {expandedUsers.has(user.userId) && (
                            <div className="bg-gray-50 px-5 pb-4">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b border-gray-200">
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">SKU</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Product</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Type</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Previous</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">New</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Change</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-right uppercase tracking-wider">Value</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Reason</th>
                                    <th className="py-2 px-2 text-xs font-semibold text-gray-600 text-left uppercase tracking-wider">Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {user.adjustments.map(a => (
                                    <tr key={a.id} className="border-b border-gray-100">
                                      <td className="py-2 px-2 text-xs font-mono text-gray-600">{a.productSku}</td>
                                      <td className="py-2 px-2 text-xs text-gray-800">{a.productName}</td>
                                      <td className="py-2 px-2"><span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 capitalize">{a.adjustmentType.replace('_', ' ')}</span></td>
                                      <td className="py-2 px-2 text-xs text-right text-gray-600">{a.previousQuantity}</td>
                                      <td className="py-2 px-2 text-xs text-right text-gray-900 font-medium">{a.newQuantity}</td>
                                      <td className={`py-2 px-2 text-xs text-right font-medium ${a.adjustmentQuantity >= 0 ? 'text-green-600' : 'text-red-600'}`}>{a.adjustmentQuantity >= 0 ? '+' : ''}{a.adjustmentQuantity}</td>
                                      <td className={`py-2 px-2 text-xs text-right font-medium ${a.adjustmentValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>${Math.abs(a.adjustmentValue).toFixed(2)}</td>
                                      <td className="py-2 px-2 text-xs text-gray-500 max-w-[150px] truncate">{a.reason || '—'}</td>
                                      <td className="py-2 px-2 text-xs text-gray-500">{new Date(a.createdAt).toLocaleDateString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Report metadata */}
          {report && (
            <div className="text-center text-xs text-gray-400 py-2">
              Report generated {new Date(report.generatedAt).toLocaleString()} • {report.companyName}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
