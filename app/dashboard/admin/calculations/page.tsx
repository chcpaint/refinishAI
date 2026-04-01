'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Shield, ArrowLeft, RefreshCw, Download, Calculator,
  CheckCircle, XCircle, AlertTriangle, Building2,
  ChevronDown, ChevronRight, TrendingUp, Package,
  BarChart3, Clock, Zap, FileText, Search
} from 'lucide-react'
import Link from 'next/link'

interface CompanyInfo {
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

interface CompanyResult {
  companyId: string
  companyName: string
  currentStock: number
  totalUsed90Days: number
  avgDailyUsage: number
  avgWeeklyUsage: number
  daysOfStockRemaining: number
  suggestedQty: number
  priority: string
  priorityReason: string
}

interface ProductRow {
  sku: string
  name: string
  category: string
  [key: string]: any
}

interface VerificationData {
  companies: CompanyInfo[]
  products: ProductRow[]
  formulaReference: Record<string, string>
  generatedAt: string
  summary: {
    totalProducts: number
    matchingCalculations: number
    mismatchCount: number
    totalComparisons: number
  }
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  urgent: 'bg-amber-100 text-amber-800 border-amber-200',
  normal: 'bg-blue-100 text-blue-800 border-blue-200',
  optional: 'bg-gray-100 text-gray-600 border-gray-200'
}

const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  urgent: 'bg-amber-500',
  normal: 'bg-blue-500',
  optional: 'bg-gray-400'
}

export default function CalculationVerificationPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<VerificationData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [selectedA, setSelectedA] = useState<string>('')
  const [selectedB, setSelectedB] = useState<string>('')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [filterMatch, setFilterMatch] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showFormulas, setShowFormulas] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Load companies for selection
  useEffect(() => {
    async function loadCompanies() {
      const { data: comps } = await supabase
        .from('companies')
        .select('id, name')
        .neq('name', 'System')
        .order('name')
      if (comps) {
        setCompanies(comps)
        if (comps.length >= 2 && !selectedA && !selectedB) {
          setSelectedA(comps[0].id)
          setSelectedB(comps[1].id)
        }
      }
    }
    loadCompanies()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const runVerification = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (selectedA) params.set('companyA', selectedA)
      if (selectedB) params.set('companyB', selectedB)

      const res = await fetch(`/api/admin/calculation-verify?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to fetch verification data')
      }
      const result: VerificationData = await res.json()
      setData(result)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedA, selectedB])

  const toggleRow = (sku: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
  }

  // Extract company results from a product row
  const getCompanyResult = (product: ProductRow, companyId: string): CompanyResult | null => {
    const stock = product[`${companyId}__currentStock`]
    if (stock === undefined && product[`${companyId}__avgDailyUsage`] === undefined) return null
    return {
      companyId,
      companyName: '',
      currentStock: product[`${companyId}__currentStock`] ?? 0,
      totalUsed90Days: product[`${companyId}__totalUsed90Days`] ?? 0,
      avgDailyUsage: product[`${companyId}__avgDailyUsage`] ?? 0,
      avgWeeklyUsage: product[`${companyId}__avgWeeklyUsage`] ?? 0,
      daysOfStockRemaining: product[`${companyId}__daysOfStockRemaining`] ?? 0,
      suggestedQty: product[`${companyId}__suggestedQty`] ?? 0,
      priority: product[`${companyId}__priority`] ?? 'optional',
      priorityReason: product[`${companyId}__priorityReason`] ?? ''
    }
  }

  // Check if priorities match across companies
  const prioritiesMatch = (product: ProductRow, companyIds: string[]): boolean => {
    const priorities = companyIds
      .map(id => product[`${id}__priority`])
      .filter(Boolean)
    if (priorities.length < 2) return true
    return priorities.every(p => p === priorities[0])
  }

  // Filter products
  const filteredProducts = data?.products.filter(product => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      if (!product.sku.toLowerCase().includes(term) &&
          !product.name.toLowerCase().includes(term) &&
          !product.category.toLowerCase().includes(term)) {
        return false
      }
    }
    if (filterPriority !== 'all' && data?.companies) {
      const hasPriority = data.companies.some(c =>
        product[`${c.id}__priority`] === filterPriority
      )
      if (!hasPriority) return false
    }
    if (filterMatch !== 'all' && data?.companies && data.companies.length >= 2) {
      const match = prioritiesMatch(product, data.companies.map(c => c.id))
      if (filterMatch === 'match' && !match) return false
      if (filterMatch === 'mismatch' && match) return false
    }
    return true
  }) || []

  // Export to Excel via API
  const handleExport = async () => {
    if (!data) return
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (selectedA) params.set('companyA', selectedA)
      if (selectedB) params.set('companyB', selectedB)
      params.set('format', 'xlsx')

      const res = await fetch(`/api/admin/calculation-verify/export?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `RefinishAI_Calculation_Verification_${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError('Export failed: ' + e.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/dashboard/admin" className="text-gray-400 hover:text-gray-600">
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div className="p-2 bg-indigo-100 rounded-lg">
                <Calculator className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Calculation Verification</h1>
                <p className="text-sm text-gray-500">Compare reorder engine calculations across companies</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {data && (
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm"
                >
                  <Download className="w-4 h-4" />
                  {exporting ? 'Exporting...' : 'Export Excel'}
                </button>
              )}
              <Link
                href="/dashboard/admin"
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
              >
                <Shield className="w-4 h-4" /> Admin
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Company Selection & Controls */}
        <div className="bg-white rounded-xl border p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4" /> Select Companies to Compare
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Company A</label>
              <select
                value={selectedA}
                onChange={(e) => setSelectedA(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
              >
                <option value="">Select company...</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Company B</label>
              <select
                value={selectedB}
                onChange={(e) => setSelectedB(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
              >
                <option value="">Select company...</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={runVerification}
              disabled={loading || (!selectedA && !selectedB)}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Calculator className="w-4 h-4" />
              )}
              {loading ? 'Running...' : 'Run Verification'}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm flex items-center gap-2">
            <XCircle className="w-5 h-5 shrink-0" /> {error}
          </div>
        )}

        {data && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border p-4">
                <div className="text-2xl font-bold text-gray-900">{data.summary.totalProducts}</div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <Package className="w-3 h-3" /> Total Products
                </div>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <div className="text-2xl font-bold text-emerald-600">{data.summary.matchingCalculations}</div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-500" /> Matching
                </div>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <div className="text-2xl font-bold text-red-600">{data.summary.mismatchCount}</div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-red-500" /> Mismatches
                </div>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <div className="text-2xl font-bold text-indigo-600">
                  {data.summary.totalComparisons > 0
                    ? Math.round((data.summary.matchingCalculations / data.summary.totalComparisons) * 100)
                    : 100}%
                </div>
                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Consistency Score
                </div>
              </div>
            </div>

            {/* Company Settings Comparison */}
            <div className="bg-white rounded-xl border p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4" /> Company Settings Comparison
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Setting</th>
                      {data.companies.map(c => (
                        <th key={c.id} className="text-right py-2 px-3 text-gray-700 font-semibold">{c.name}</th>
                      ))}
                      {data.companies.length >= 2 && (
                        <th className="text-center py-2 px-3 text-gray-500 font-medium">Match</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: 'Deliveries/Week', key: 'deliveriesPerWeek' },
                      { label: 'Lead Time (days)', key: 'leadTimeDays' },
                      { label: 'Safety Stock (days)', key: 'safetyStockDays' },
                      { label: 'Days Between Deliveries', key: 'daysBetweenDeliveries' },
                      { label: 'Reorder Point', key: 'reorderPoint' },
                      { label: 'Default Order Qty', key: 'defaultOrderQty' },
                    ].map(row => {
                      const values = data.companies.map(c => (c.settings as any)[row.key])
                      const allMatch = values.every(v => v === values[0])
                      return (
                        <tr key={row.key} className="border-b last:border-0">
                          <td className="py-2 px-3 text-gray-600">{row.label}</td>
                          {data.companies.map((c, i) => (
                            <td key={c.id} className="py-2 px-3 text-right font-mono">{values[i]}</td>
                          ))}
                          {data.companies.length >= 2 && (
                            <td className="py-2 px-3 text-center">
                              {allMatch ? (
                                <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Formula Reference (collapsible) */}
            <div className="bg-white rounded-xl border">
              <button
                onClick={() => setShowFormulas(!showFormulas)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Formula Reference
                </h2>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showFormulas ? 'rotate-180' : ''}`} />
              </button>
              {showFormulas && (
                <div className="px-5 pb-5 border-t pt-4">
                  <div className="grid gap-2">
                    {Object.entries(data.formulaReference).map(([key, formula]) => (
                      <div key={key} className="flex gap-3 text-sm">
                        <span className="font-mono text-indigo-600 font-medium min-w-[200px] shrink-0">{key}</span>
                        <span className="font-mono text-gray-600 text-xs bg-gray-50 px-2 py-1 rounded">{formula}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border p-4 flex flex-wrap items-center gap-4">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search SKU, product name, category..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-3 py-2 border rounded-lg text-sm bg-white"
              >
                <option value="all">All Priorities</option>
                <option value="critical">Critical</option>
                <option value="urgent">Urgent</option>
                <option value="normal">Normal</option>
                <option value="optional">Optional</option>
              </select>
              {data.companies.length >= 2 && (
                <select
                  value={filterMatch}
                  onChange={(e) => setFilterMatch(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm bg-white"
                >
                  <option value="all">All Results</option>
                  <option value="match">Matching Only</option>
                  <option value="mismatch">Mismatches Only</option>
                </select>
              )}
              <span className="text-xs text-gray-500">
                Showing {filteredProducts.length} of {data.products.length} products
              </span>
            </div>

            {/* Product Calculation Table */}
            <div className="bg-white rounded-xl border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left py-3 px-3 font-medium text-xs">Product</th>
                      <th className="text-left py-3 px-2 font-medium text-xs">Category</th>
                      {data.companies.map(c => (
                        <th key={`${c.id}-pri`} className="text-center py-3 px-2 font-medium text-xs">
                          {c.name}<br/><span className="font-normal opacity-75">Priority</span>
                        </th>
                      ))}
                      {data.companies.map(c => (
                        <th key={`${c.id}-stock`} className="text-right py-3 px-2 font-medium text-xs">
                          {c.name}<br/><span className="font-normal opacity-75">Stock</span>
                        </th>
                      ))}
                      {data.companies.map(c => (
                        <th key={`${c.id}-days`} className="text-right py-3 px-2 font-medium text-xs">
                          {c.name}<br/><span className="font-normal opacity-75">Days Left</span>
                        </th>
                      ))}
                      {data.companies.map(c => (
                        <th key={`${c.id}-order`} className="text-right py-3 px-2 font-medium text-xs">
                          {c.name}<br/><span className="font-normal opacity-75">Order Qty</span>
                        </th>
                      ))}
                      {data.companies.length >= 2 && (
                        <th className="text-center py-3 px-2 font-medium text-xs">Match</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const isExpanded = expandedRows.has(product.sku)
                      const companyIds = data.companies.map(c => c.id)
                      const isMatch = prioritiesMatch(product, companyIds)

                      return (
                        <>
                          <tr
                            key={product.sku}
                            onClick={() => toggleRow(product.sku)}
                            className={`border-b cursor-pointer hover:bg-gray-50 transition-colors ${
                              !isMatch && data.companies.length >= 2 ? 'bg-red-50/50' : ''
                            }`}
                          >
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                )}
                                <div>
                                  <div className="font-medium text-gray-900">{product.sku}</div>
                                  <div className="text-xs text-gray-500 truncate max-w-[180px]">{product.name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-gray-600 text-xs">{product.category}</td>
                            {data.companies.map(c => {
                              const pri = product[`${c.id}__priority`] || 'optional'
                              return (
                                <td key={`${c.id}-pri`} className="py-2.5 px-2 text-center">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_COLORS[pri]}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[pri]}`} />
                                    {pri}
                                  </span>
                                </td>
                              )
                            })}
                            {data.companies.map(c => (
                              <td key={`${c.id}-stock`} className="py-2.5 px-2 text-right font-mono text-gray-700">
                                {product[`${c.id}__currentStock`] ?? '—'}
                              </td>
                            ))}
                            {data.companies.map(c => {
                              const days = product[`${c.id}__daysOfStockRemaining`]
                              return (
                                <td key={`${c.id}-days`} className={`py-2.5 px-2 text-right font-mono ${
                                  days === 999 ? 'text-gray-400' : days <= 3 ? 'text-red-600 font-bold' : 'text-gray-700'
                                }`}>
                                  {days ?? '—'}
                                </td>
                              )
                            })}
                            {data.companies.map(c => (
                              <td key={`${c.id}-order`} className="py-2.5 px-2 text-right font-mono font-medium text-indigo-700">
                                {product[`${c.id}__suggestedQty`] ?? '—'}
                              </td>
                            ))}
                            {data.companies.length >= 2 && (
                              <td className="py-2.5 px-2 text-center">
                                {isMatch ? (
                                  <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-500 mx-auto" />
                                )}
                              </td>
                            )}
                          </tr>
                          {isExpanded && (
                            <tr key={`${product.sku}-detail`} className="bg-slate-50 border-b">
                              <td colSpan={100} className="px-6 py-4">
                                <div className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">
                                  Calculation Breakdown — {product.sku}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {data.companies.map(company => {
                                    const r = getCompanyResult(product, company.id)
                                    if (!r) return null
                                    return (
                                      <div key={company.id} className="bg-white rounded-lg border p-4">
                                        <div className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                                          <Building2 className="w-4 h-4 text-indigo-500" />
                                          {company.name}
                                        </div>
                                        <div className="space-y-2 text-xs">
                                          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                            <div className="text-gray-500">Current Stock</div>
                                            <div className="font-mono text-right font-medium">{r.currentStock}</div>

                                            <div className="text-gray-500">90-Day Usage</div>
                                            <div className="font-mono text-right">{r.totalUsed90Days}</div>

                                            <div className="text-gray-500">Avg Daily Usage</div>
                                            <div className="font-mono text-right text-blue-600">
                                              {r.totalUsed90Days} / 90 = <strong>{r.avgDailyUsage}</strong>
                                            </div>

                                            <div className="text-gray-500">Avg Weekly Usage</div>
                                            <div className="font-mono text-right text-blue-600">
                                              {r.avgDailyUsage} × 7 = <strong>{r.avgWeeklyUsage}</strong>
                                            </div>

                                            <div className="text-gray-500">Days of Stock</div>
                                            <div className={`font-mono text-right font-medium ${
                                              r.daysOfStockRemaining === 999 ? 'text-gray-400' :
                                              r.daysOfStockRemaining <= 3 ? 'text-red-600' : 'text-gray-800'
                                            }`}>
                                              {r.avgDailyUsage > 0
                                                ? `${r.currentStock} / ${r.avgDailyUsage} = ${r.daysOfStockRemaining}`
                                                : r.currentStock > 0 ? '999 (no usage)' : '0 (no stock/usage)'}
                                            </div>

                                            <div className="text-gray-500">Suggested Order</div>
                                            <div className="font-mono text-right text-indigo-700 font-bold">
                                              {r.suggestedQty}
                                            </div>

                                            <div className="text-gray-500">Priority</div>
                                            <div className="text-right">
                                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_COLORS[r.priority]}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[r.priority]}`} />
                                                {r.priority}
                                              </span>
                                            </div>

                                            <div className="text-gray-500">Reason</div>
                                            <div className="text-right text-gray-600 italic">{r.priorityReason}</div>
                                          </div>

                                          <div className="mt-3 pt-3 border-t">
                                            <div className="text-gray-400 font-semibold mb-1">Formula Steps</div>
                                            <div className="font-mono text-[11px] leading-relaxed text-gray-500 space-y-0.5">
                                              <div>daysBetweenDeliveries = 7 / {company.settings.deliveriesPerWeek} = {company.settings.daysBetweenDeliveries}</div>
                                              <div>usageTilNext = {r.avgDailyUsage} × {company.settings.daysBetweenDeliveries} = {(r.avgDailyUsage * company.settings.daysBetweenDeliveries).toFixed(2)}</div>
                                              <div>safetyQty = {r.avgDailyUsage} × {company.settings.safetyStockDays} = {(r.avgDailyUsage * company.settings.safetyStockDays).toFixed(2)}</div>
                                              <div>rawOrder = ceil({(r.avgDailyUsage * company.settings.daysBetweenDeliveries).toFixed(2)} + {(r.avgDailyUsage * company.settings.safetyStockDays).toFixed(2)}) - {r.currentStock} = {Math.ceil(r.avgDailyUsage * company.settings.daysBetweenDeliveries + r.avgDailyUsage * company.settings.safetyStockDays) - r.currentStock}</div>
                                              <div>suggestedQty = max(rawOrder, {company.settings.defaultOrderQty}) = <strong>{r.suggestedQty}</strong></div>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {filteredProducts.length === 0 && !loading && (
                <div className="text-center py-12 text-gray-400">
                  <Calculator className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">No products found</p>
                  <p className="text-sm">Adjust your filters or run a verification</p>
                </div>
              )}
            </div>

            {/* Timestamp */}
            <div className="text-xs text-gray-400 text-right flex items-center justify-end gap-1">
              <Clock className="w-3 h-3" />
              Report generated: {new Date(data.generatedAt).toLocaleString()}
            </div>
          </>
        )}

        {!data && !loading && !error && (
          <div className="bg-white rounded-xl border p-12 text-center">
            <Calculator className="w-12 h-12 mx-auto text-indigo-300 mb-4" />
            <h2 className="text-lg font-semibold text-gray-700 mb-2">Calculation Verification Engine</h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto mb-6">
              Select two companies above and run verification to compare how the reorder engine
              calculates priorities, order quantities, and stock levels across shops.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto text-left">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="font-medium text-gray-700 text-sm mb-1">Side-by-Side</div>
                <div className="text-xs text-gray-500">Compare identical products across two shops</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="font-medium text-gray-700 text-sm mb-1">Formula Audit</div>
                <div className="text-xs text-gray-500">Expand any row to see step-by-step math</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="font-medium text-gray-700 text-sm mb-1">Excel Export</div>
                <div className="text-xs text-gray-500">Download a client-ready verification report</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
