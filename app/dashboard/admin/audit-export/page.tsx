'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  FileText, Shield, ArrowLeft, RefreshCw, Download,
  CheckCircle, XCircle, AlertTriangle, Cpu, Brain,
  Clock, Database, Building2, ChevronDown, ChevronRight,
  Printer, Eye, Hash, DollarSign, Percent, BarChart3,
  Zap, TrendingUp, ShoppingCart, Package
} from 'lucide-react'
import Link from 'next/link'

interface AuditData {
  company: { id: string; name: string; city: string; state: string; zip: string; created_at: string }
  periodDays: number
  reportDate: string
  dataInputs: {
    invoices: any[]
    estimates: any[]
    consumptionRecords: number
    products: any[]
  }
  computedMetrics: {
    invoiceStats: { count: number; totalRevenue: number; avgInvoice: number; totalMaterial: number; totalLabor: number }
    wasteAnalysis: {
      totalEstimatedQuantity: number
      totalActualQuantity: number
      overallWastePercent: number
      byCategory: { category: string; expected: number; actual: number; wastePercent: number; records: number }[]
    }
    confidenceFormula: {
      base: number
      invoiceComponent: number
      consumptionComponent: number
      total: number
      meetsProjectionThreshold: boolean
      invoiceThreshold: string
      consumptionThreshold: string
    }
  }
  reorderRecommendations: {
    items: any[]
    summary: { totalItems: number; criticalItems: number; urgentItems: number; normalItems: number; totalEstimatedCost: number }
    upcomingEstimates: any[]
    methodology: Record<string, string>
  }
  engineActivity: {
    summary: {
      total: number
      byType: Record<string, number>
      byMethod: Record<string, number>
      byComputation: Record<string, number>
      avgExecutionMs: number
      errors: number
      rejections: number
    }
    logs: any[]
  }
  methodology: Record<string, string>
}

const ACTIVITY_LABELS: Record<string, string> = {
  base_calculation: 'Base Calculation',
  insufficient_data: 'Insufficient Data',
  llm_forecast: 'LLM Forecast',
  llm_recommendation: 'LLM Recommendation',
  llm_analysis: 'LLM Analysis',
  fallback_stale_data: 'Stale Data Fallback',
  fallback_no_data: 'No Data Fallback',
  error: 'Error'
}

const COMPUTATION_LABELS: Record<string, string> = {
  rule_based: 'Rule-Based',
  statistical: 'Statistical',
  llm_assisted: 'LLM-Assisted',
  hybrid: 'Hybrid'
}

export default function AuditExportPage() {
  const [data, setData] = useState<AuditData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [periodDays, setPeriodDays] = useState(90)
  const [authorized, setAuthorized] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['methodology', 'confidence', 'activity']))
  const reportRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not authenticated'); return }
      const { data: profile } = await supabase
        .from('user_profiles').select('role').eq('id', user.id).single()
      if (profile?.role !== 'super_admin') { setError('Access denied'); return }
      setAuthorized(true)

      const { data: comps } = await supabase
        .from('companies').select('id, name')
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .neq('name', 'System')
        .order('name')
      setCompanies(comps || [])
    }
    init()
  }, [])

  const fetchAudit = useCallback(async () => {
    if (!selectedCompany) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/audit-export?companyId=${selectedCompany}&periodDays=${periodDays}`)
      if (!res.ok) { const err = await res.json(); throw new Error(err.error) }
      setData(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [selectedCompany, periodDays])

  const handlePrint = () => {
    window.print()
  }

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(section) ? next.delete(section) : next.add(section)
      return next
    })
  }

  if (!authorized && error) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
        <p className="text-slate-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Controls - hidden in print */}
      <div className="print:hidden space-y-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard/admin" className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <FileText className="w-6 h-6 text-blue-400" />
                Audit Export
              </h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Generate transparency reports showing all calculations and source data
              </p>
            </div>
          </div>
          {data && (
            <button onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors">
              <Printer className="w-4 h-4" />
              Print / Save as PDF
            </button>
          )}
        </div>

        {/* Selectors */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Company</label>
            <select value={selectedCompany} onChange={e => setSelectedCompany(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm min-w-[200px]">
              <option value="">Select a company...</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Period</label>
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
              {[30, 60, 90, 180, 365].map(d => (
                <button key={d} onClick={() => setPeriodDays(d)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    periodDays === d ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}>{d < 365 ? `${d}d` : '1y'}</button>
              ))}
            </div>
          </div>
          <button onClick={fetchAudit} disabled={!selectedCompany || loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Generate Report
          </button>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
          <span className="ml-3 text-slate-400">Generating audit report...</span>
        </div>
      )}

      {/* Report Content */}
      {data && !loading && (
        <div ref={reportRef} className="space-y-6 print:space-y-4">

          {/* Report Header */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 print:bg-white print:border-gray-300 print:text-black">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white print:text-black">
                  refinishAI — Calculation Audit Report
                </h1>
                <p className="text-slate-400 print:text-gray-600 mt-1">
                  Transparency & Methodology Documentation
                </p>
              </div>
              <div className="text-right text-sm text-slate-400 print:text-gray-600">
                <p>Generated: {new Date(data.reportDate).toLocaleDateString()}</p>
                <p>Period: Last {data.periodDays} days</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <span className="text-xs text-slate-500 print:text-gray-500">Company</span>
                <p className="text-white print:text-black font-semibold">{data.company.name}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 print:text-gray-500">Location</span>
                <p className="text-white print:text-black font-semibold">{data.company.city}, {data.company.state} {data.company.zip}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 print:text-gray-500">Member Since</span>
                <p className="text-white print:text-black font-semibold">{new Date(data.company.created_at).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 print:text-gray-500">Data Points</span>
                <p className="text-white print:text-black font-semibold">
                  {data.dataInputs.invoices.length} invoices · {data.dataInputs.consumptionRecords} consumption · {data.dataInputs.products.length} products
                </p>
              </div>
            </div>
          </div>

          {/* Section 1: Methodology */}
          <ReportSection title="Methodology & Approach" icon={Cpu} id="methodology"
            expanded={expandedSections.has('methodology')} onToggle={() => toggleSection('methodology')}>
            <div className="space-y-3">
              {Object.entries(data.methodology).map(([key, value]) => (
                <div key={key} className="bg-slate-900/50 print:bg-gray-50 rounded-lg p-3">
                  <span className="text-xs font-medium text-blue-400 print:text-blue-600 uppercase tracking-wider">
                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                  </span>
                  <p className="text-sm text-slate-300 print:text-gray-700 mt-1">{value}</p>
                </div>
              ))}
            </div>
          </ReportSection>

          {/* Section 2: Confidence Score Breakdown */}
          <ReportSection title="Confidence Score Breakdown" icon={BarChart3} id="confidence"
            expanded={expandedSections.has('confidence')} onToggle={() => toggleSection('confidence')}>
            <div className="space-y-4">
              <div className="bg-slate-900/50 print:bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-slate-400 print:text-gray-600 mb-3">
                  <span className="font-mono">confidence = 20 (base) + min(invoices/50, 1) × 40 + min(consumption/200, 1) × 40</span>
                </p>
                <div className="space-y-2">
                  <FormulaRow label="Base score" value={data.computedMetrics.confidenceFormula.base} />
                  <FormulaRow label={`Invoice component (${data.computedMetrics.confidenceFormula.invoiceThreshold})`}
                    value={data.computedMetrics.confidenceFormula.invoiceComponent} />
                  <FormulaRow label={`Consumption component (${data.computedMetrics.confidenceFormula.consumptionThreshold})`}
                    value={data.computedMetrics.confidenceFormula.consumptionComponent} />
                  <div className="border-t border-slate-700 print:border-gray-300 pt-2 mt-2">
                    <FormulaRow label="Total confidence" value={data.computedMetrics.confidenceFormula.total} bold />
                  </div>
                </div>
              </div>
              <div className={`rounded-lg p-3 text-sm ${
                data.computedMetrics.confidenceFormula.meetsProjectionThreshold
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 print:text-emerald-700'
                  : 'bg-amber-500/10 border border-amber-500/30 text-amber-400 print:text-amber-700'
              }`}>
                {data.computedMetrics.confidenceFormula.meetsProjectionThreshold
                  ? '✓ Meets minimum data threshold for projections (≥50 invoices, ≥100 consumption records)'
                  : '✗ Does NOT meet minimum threshold — projections will be rejected until more data is collected'}
              </div>
            </div>
          </ReportSection>

          {/* Section 3: Engine Activity Summary */}
          <ReportSection title="Engine Activity Summary" icon={Zap} id="activity"
            expanded={expandedSections.has('activity')} onToggle={() => toggleSection('activity')}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total Operations" value={data.engineActivity.summary.total} />
                <StatCard label="Avg Execution" value={`${data.engineActivity.summary.avgExecutionMs}ms`} />
                <StatCard label="Errors" value={data.engineActivity.summary.errors} alert={data.engineActivity.summary.errors > 0} />
                <StatCard label="Rejections" value={data.engineActivity.summary.rejections} />
              </div>

              {/* By computation type */}
              <div>
                <h4 className="text-sm font-medium text-slate-400 print:text-gray-600 mb-2">Computation Methods Used</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(data.engineActivity.summary.byComputation).map(([type, count]) => (
                    <div key={type} className="bg-slate-900/50 print:bg-gray-50 rounded p-3 text-center">
                      <p className="text-lg font-bold text-white print:text-black">{count as number}</p>
                      <p className="text-xs text-slate-400 print:text-gray-600">{COMPUTATION_LABELS[type] || type}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* LLM transparency callout */}
              <div className="bg-emerald-500/10 border border-emerald-500/30 print:bg-emerald-50 print:border-emerald-300 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-emerald-400 print:text-emerald-600" />
                  <span className="font-semibold text-emerald-400 print:text-emerald-700">LLM / AI Model Transparency</span>
                </div>
                {(data.engineActivity.summary.byComputation['llm_assisted'] || 0) +
                 (data.engineActivity.summary.byComputation['hybrid'] || 0) === 0 ? (
                  <p className="text-sm text-slate-300 print:text-gray-700">
                    No LLM or external AI model calls were made for this company during the reporting period.
                    All {data.engineActivity.summary.total} operations used deterministic rule-based or statistical methods.
                    Every calculation result is fully reproducible from the source data shown in this report.
                  </p>
                ) : (
                  <p className="text-sm text-slate-300 print:text-gray-700">
                    {(data.engineActivity.summary.byComputation['llm_assisted'] || 0) +
                     (data.engineActivity.summary.byComputation['hybrid'] || 0)} operations used LLM assistance.
                    Full details including provider, model, token usage, and costs are logged in the activity entries below.
                  </p>
                )}
              </div>

              {/* By activity type */}
              <div>
                <h4 className="text-sm font-medium text-slate-400 print:text-gray-600 mb-2">Activity Type Breakdown</h4>
                <div className="space-y-1">
                  {Object.entries(data.engineActivity.summary.byType).sort(([,a],[,b]) => (b as number) - (a as number)).map(([type, count]) => (
                    <div key={type} className="flex justify-between bg-slate-900/50 print:bg-gray-50 rounded p-2 text-sm">
                      <span className="text-slate-300 print:text-gray-700">{ACTIVITY_LABELS[type] || type}</span>
                      <span className="text-white print:text-black font-medium">{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ReportSection>

          {/* Section 4: Invoice Data Used */}
          <ReportSection title={`Invoices Used in Calculations (${data.dataInputs.invoices.length})`} icon={DollarSign} id="invoices"
            expanded={expandedSections.has('invoices')} onToggle={() => toggleSection('invoices')}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <StatCard label="Total Revenue" value={`$${data.computedMetrics.invoiceStats.totalRevenue.toLocaleString(undefined, {minimumFractionDigits: 2})}`} />
                <StatCard label="Avg Invoice" value={`$${data.computedMetrics.invoiceStats.avgInvoice.toLocaleString(undefined, {minimumFractionDigits: 2})}`} />
                <StatCard label="Material Cost" value={`$${data.computedMetrics.invoiceStats.totalMaterial.toLocaleString(undefined, {minimumFractionDigits: 2})}`} />
                <StatCard label="Labor Cost" value={`$${data.computedMetrics.invoiceStats.totalLabor.toLocaleString(undefined, {minimumFractionDigits: 2})}`} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 print:border-gray-300">
                      <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Invoice #</th>
                      <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Date</th>
                      <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Total</th>
                      <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Material</th>
                      <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Labor</th>
                      <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Status</th>
                      <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Vehicle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dataInputs.invoices.map(inv => (
                      <tr key={inv.id} className="border-b border-slate-800 print:border-gray-200">
                        <td className="py-1.5 text-white print:text-black font-mono text-xs">{inv.number || inv.id.slice(0, 8)}</td>
                        <td className="py-1.5 text-slate-300 print:text-gray-700">{inv.date}</td>
                        <td className="py-1.5 text-right text-white print:text-black">${(inv.total || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="py-1.5 text-right text-slate-300 print:text-gray-700">${(inv.material || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="py-1.5 text-right text-slate-300 print:text-gray-700">${(inv.labor || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                        <td className="py-1.5 text-slate-300 print:text-gray-700">{inv.status || '—'}</td>
                        <td className="py-1.5 text-slate-400 print:text-gray-500 text-xs truncate max-w-[150px]">{inv.vehicle || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </ReportSection>

          {/* Section 5: Estimates */}
          <ReportSection title={`Estimates in Period (${data.dataInputs.estimates.length})`} icon={FileText} id="estimates"
            expanded={expandedSections.has('estimates')} onToggle={() => toggleSection('estimates')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 print:border-gray-300">
                    <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Estimate #</th>
                    <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Date</th>
                    <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Total</th>
                    <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Status</th>
                    <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Source</th>
                    <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Vehicle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dataInputs.estimates.map(est => (
                    <tr key={est.id} className="border-b border-slate-800 print:border-gray-200">
                      <td className="py-1.5 text-white print:text-black font-mono text-xs">{est.number || est.id.slice(0, 8)}</td>
                      <td className="py-1.5 text-slate-300 print:text-gray-700">{est.date}</td>
                      <td className="py-1.5 text-right text-white print:text-black">${(est.total || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                      <td className="py-1.5 text-slate-300 print:text-gray-700">{est.status || '—'}</td>
                      <td className="py-1.5 text-slate-300 print:text-gray-700">{est.source || '—'}</td>
                      <td className="py-1.5 text-slate-400 print:text-gray-500 text-xs truncate max-w-[150px]">{est.vehicle || '—'}</td>
                    </tr>
                  ))}
                  {data.dataInputs.estimates.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-slate-500">No estimates in this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </ReportSection>

          {/* Section 6: Waste Analysis */}
          <ReportSection title="Waste Analysis Breakdown" icon={Percent} id="waste"
            expanded={expandedSections.has('waste')} onToggle={() => toggleSection('waste')}>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Estimated Qty" value={data.computedMetrics.wasteAnalysis.totalEstimatedQuantity.toLocaleString()} />
                <StatCard label="Actual Qty" value={data.computedMetrics.wasteAnalysis.totalActualQuantity.toLocaleString()} />
                <StatCard label="Overall Waste %" value={`${data.computedMetrics.wasteAnalysis.overallWastePercent}%`}
                  alert={data.computedMetrics.wasteAnalysis.overallWastePercent > 15} />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 print:border-gray-300">
                      <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Category</th>
                      <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Expected</th>
                      <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Actual</th>
                      <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Waste %</th>
                      <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.computedMetrics.wasteAnalysis.byCategory.map(cat => (
                      <tr key={cat.category} className="border-b border-slate-800 print:border-gray-200">
                        <td className="py-1.5 text-white print:text-black">{cat.category}</td>
                        <td className="py-1.5 text-right text-slate-300 print:text-gray-700">{cat.expected.toLocaleString()}</td>
                        <td className="py-1.5 text-right text-slate-300 print:text-gray-700">{cat.actual.toLocaleString()}</td>
                        <td className={`py-1.5 text-right font-medium ${cat.wastePercent > 15 ? 'text-red-400 print:text-red-600' : 'text-emerald-400 print:text-emerald-600'}`}>
                          {cat.wastePercent}%
                        </td>
                        <td className="py-1.5 text-right text-slate-400 print:text-gray-500">{cat.records}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </ReportSection>

          {/* Section 7: Reorder Recommendations with Full Formulas */}
          <ReportSection title={`Recommended Orders (${data.reorderRecommendations.items.length} items)`} icon={ShoppingCart} id="reorder"
            expanded={expandedSections.has('reorder')} onToggle={() => toggleSection('reorder')}>
            <div className="space-y-4">
              {/* Reorder summary */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Items to Order" value={data.reorderRecommendations.summary.totalItems} />
                <StatCard label="Critical" value={data.reorderRecommendations.summary.criticalItems} alert={data.reorderRecommendations.summary.criticalItems > 0} />
                <StatCard label="Urgent" value={data.reorderRecommendations.summary.urgentItems} alert={data.reorderRecommendations.summary.urgentItems > 0} />
                <StatCard label="Normal" value={data.reorderRecommendations.summary.normalItems} />
                <StatCard label="Est. Cost" value={`$${data.reorderRecommendations.summary.totalEstimatedCost.toLocaleString(undefined, {minimumFractionDigits: 2})}`} />
              </div>

              {/* Methodology */}
              <div className="bg-slate-900/50 print:bg-gray-50 rounded-lg p-3">
                <h4 className="text-xs font-medium text-blue-400 print:text-blue-600 uppercase tracking-wider mb-2">Reorder Formulas</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {Object.entries(data.reorderRecommendations.methodology).map(([key, formula]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-slate-500 print:text-gray-500 font-medium whitespace-nowrap">{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</span>
                      <span className="text-slate-300 print:text-gray-700 font-mono">{formula}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upcoming estimates driving the reorder */}
              {data.reorderRecommendations.upcomingEstimates.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-400 print:text-gray-600 mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Upcoming Estimates Driving Projected Demand ({data.reorderRecommendations.upcomingEstimates.length})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700 print:border-gray-300">
                          <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Estimate #</th>
                          <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Date</th>
                          <th className="text-right py-2 text-slate-400 print:text-gray-600 font-medium">Total</th>
                          <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Status</th>
                          <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Vehicle</th>
                          <th className="text-left py-2 text-slate-400 print:text-gray-600 font-medium">Insurance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.reorderRecommendations.upcomingEstimates.map((est: any) => (
                          <tr key={est.id} className="border-b border-slate-800 print:border-gray-200">
                            <td className="py-1.5 text-white print:text-black font-mono text-xs">{est.number || est.id.slice(0, 8)}</td>
                            <td className="py-1.5 text-slate-300 print:text-gray-700">{est.date}</td>
                            <td className="py-1.5 text-right text-white print:text-black">${(est.total || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                            <td className="py-1.5">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                est.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-400 print:text-emerald-700' :
                                est.status === 'Scheduled' ? 'bg-blue-500/20 text-blue-400 print:text-blue-700' :
                                'bg-slate-500/20 text-slate-400 print:text-gray-600'
                              }`}>{est.status}</span>
                            </td>
                            <td className="py-1.5 text-slate-400 print:text-gray-500 text-xs truncate max-w-[150px]">{est.vehicle || '—'}</td>
                            <td className="py-1.5 text-slate-400 print:text-gray-500 text-xs truncate max-w-[120px]">{est.insurance || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Reorder items with full formula breakdown */}
              {data.reorderRecommendations.items.length > 0 ? (
                <div>
                  <h4 className="text-sm font-medium text-slate-400 print:text-gray-600 mb-2 flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Items to Order — Full Calculation Breakdown
                  </h4>
                  <div className="space-y-2">
                    {data.reorderRecommendations.items.map((item: any) => (
                      <div key={item.productId} className="bg-slate-900/50 print:bg-gray-50 rounded-lg p-3 print:break-inside-avoid">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              item.priority === 'critical' ? 'bg-red-500/20 text-red-400 print:text-red-700' :
                              item.priority === 'urgent' ? 'bg-amber-500/20 text-amber-400 print:text-amber-700' :
                              'bg-blue-500/20 text-blue-400 print:text-blue-700'
                            }`}>{item.priority.toUpperCase()}</span>
                            <span className="text-white print:text-black font-medium">{item.productName}</span>
                            <span className="text-slate-500 print:text-gray-500 font-mono text-xs">{item.sku}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-white print:text-black font-bold">Order {item.suggestedOrderQty} units</span>
                            <span className="text-slate-400 print:text-gray-500 text-sm ml-2">(${item.extendedCost.toFixed(2)})</span>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                          <div><span className="text-slate-500">Current Stock:</span> <span className="text-white print:text-black">{item.currentStock}</span></div>
                          <div><span className="text-slate-500">Reorder Point:</span> <span className="text-white print:text-black">{item.reorderPoint}</span></div>
                          <div><span className="text-slate-500">Par Level:</span> <span className="text-white print:text-black">{item.parLevel}</span></div>
                          <div><span className="text-slate-500">Days Remaining:</span>
                            <span className={`font-medium ml-1 ${item.daysOfStockRemaining <= 3 ? 'text-red-400 print:text-red-600' : item.daysOfStockRemaining <= 7 ? 'text-amber-400 print:text-amber-700' : 'text-white print:text-black'}`}>
                              {item.daysOfStockRemaining > 900 ? '∞' : item.daysOfStockRemaining}
                            </span>
                          </div>
                        </div>
                        {/* Show the work */}
                        <div className="mt-2 bg-slate-800/50 print:bg-gray-100 rounded p-2 text-xs font-mono space-y-0.5">
                          <p className="text-slate-400 print:text-gray-600">Avg Daily Usage: <span className="text-slate-300 print:text-gray-700">{item.formula.avgDailyUsage}</span></p>
                          <p className="text-slate-400 print:text-gray-600">Days Remaining: <span className="text-slate-300 print:text-gray-700">{item.formula.daysRemaining}</span></p>
                          <p className="text-slate-400 print:text-gray-600">Suggested Order: <span className="text-slate-300 print:text-gray-700">{item.formula.suggestedQty}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-slate-500 text-sm text-center py-4">All products are above reorder point — no orders recommended at this time.</p>
              )}
            </div>
          </ReportSection>

          {/* Section 8: Detailed Activity Log */}
          <ReportSection title={`Detailed Calculation Log (${data.engineActivity.logs.length} entries)`} icon={Eye} id="logs"
            expanded={expandedSections.has('logs')} onToggle={() => toggleSection('logs')}>
            <div className="space-y-2">
              {data.engineActivity.logs.map(log => (
                <div key={log.id} className="bg-slate-900/50 print:bg-gray-50 rounded-lg p-3 text-sm print:break-inside-avoid">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        log.activityType === 'base_calculation' ? 'bg-emerald-500/20 text-emerald-400 print:text-emerald-700' :
                        log.activityType === 'insufficient_data' ? 'bg-amber-500/20 text-amber-400 print:text-amber-700' :
                        log.activityType === 'error' ? 'bg-red-500/20 text-red-400 print:text-red-700' :
                        'bg-slate-500/20 text-slate-400 print:text-gray-600'
                      }`}>{ACTIVITY_LABELS[log.activityType] || log.activityType}</span>
                      <span className="font-mono text-xs text-slate-500 print:text-gray-500">{log.method}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 print:text-blue-700">
                        {COMPUTATION_LABELS[log.computationType] || log.computationType}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 print:text-gray-500">
                      {new Date(log.timestamp).toLocaleString()} · {log.executionMs || 0}ms
                    </div>
                  </div>
                  {log.summary && <p className="text-slate-300 print:text-gray-700 mt-1">{log.summary}</p>}
                  <div className="flex gap-4 mt-1 text-xs text-slate-500 print:text-gray-500">
                    <span>Invoices: {log.invoicesUsed}</span>
                    <span>Consumption: {log.consumptionUsed}</span>
                    <span>Products: {log.productsUsed}</span>
                    {log.confidence && <span>Confidence: {log.confidence}%</span>}
                  </div>
                  {log.llm && (
                    <div className="mt-1 text-xs bg-purple-500/10 print:bg-purple-50 rounded p-1.5 text-purple-300 print:text-purple-700">
                      LLM: {log.llm.model} via {log.llm.provider} · {log.llm.tokens} tokens · {log.llm.latencyMs}ms · ${log.llm.cost?.toFixed(4)}
                    </div>
                  )}
                  {log.error && (
                    <p className="mt-1 text-xs text-red-400 print:text-red-600">Error: {log.error}</p>
                  )}
                </div>
              ))}
              {data.engineActivity.logs.length === 0 && (
                <p className="text-slate-500 text-sm text-center py-4">
                  No engine activity logged yet. Activity will appear here once the AI engine processes calculations for this company.
                </p>
              )}
            </div>
          </ReportSection>

          {/* Footer */}
          <div className="text-center text-xs text-slate-500 print:text-gray-500 py-4 border-t border-slate-700 print:border-gray-300">
            <p>refinishAI Calculation Audit Report — {data.company.name}</p>
            <p>Generated {new Date(data.reportDate).toLocaleString()} · Period: Last {data.periodDays} days</p>
            <p className="mt-1">This report is provided for transparency and onboarding verification purposes.</p>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          .print\\:bg-white { background: white !important; }
          .print\\:border-gray-300 { border-color: #d1d5db !important; }
          .print\\:text-black { color: black !important; }
          .print\\:text-gray-600 { color: #4b5563 !important; }
          .print\\:text-gray-700 { color: #374151 !important; }
          .print\\:text-gray-500 { color: #6b7280 !important; }
          .print\\:bg-gray-50 { background: #f9fafb !important; }
          .print\\:bg-emerald-50 { background: #ecfdf5 !important; }
          .print\\:border-emerald-300 { border-color: #6ee7b7 !important; }
          .print\\:text-emerald-600 { color: #059669 !important; }
          .print\\:text-emerald-700 { color: #047857 !important; }
          .print\\:text-amber-700 { color: #b45309 !important; }
          .print\\:text-red-600 { color: #dc2626 !important; }
          .print\\:text-red-700 { color: #b91c1c !important; }
          .print\\:text-blue-600 { color: #2563eb !important; }
          .print\\:text-blue-700 { color: #1d4ed8 !important; }
          .print\\:text-purple-700 { color: #7e22ce !important; }
          .print\\:bg-purple-50 { background: #faf5ff !important; }
          .print\\:border-gray-200 { border-color: #e5e7eb !important; }
          nav, .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  )
}

function ReportSection({ title, icon: Icon, id, expanded, onToggle, children }: {
  title: string; icon: any; id: string; expanded: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden print:bg-white print:border-gray-300 print:break-inside-avoid-page">
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 hover:bg-slate-700/30 transition-colors text-left print:pointer-events-none">
        <Icon className="w-5 h-5 text-blue-400 print:text-blue-600 shrink-0" />
        <h2 className="text-lg font-semibold text-white print:text-black flex-1">{title}</h2>
        <span className="print:hidden">
          {expanded ? <ChevronDown className="w-5 h-5 text-slate-400" /> : <ChevronRight className="w-5 h-5 text-slate-400" />}
        </span>
      </button>
      <div className={`px-4 pb-4 ${expanded ? '' : 'hidden print:block'}`}>
        {children}
      </div>
    </div>
  )
}

function FormulaRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${bold ? 'text-white print:text-black font-semibold' : 'text-slate-400 print:text-gray-600'}`}>{label}</span>
      <span className={`font-mono text-sm ${bold ? 'text-blue-400 print:text-blue-600 font-bold text-base' : 'text-white print:text-black'}`}>
        {value}
      </span>
    </div>
  )
}

function StatCard({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className={`rounded-lg p-3 text-center ${
      alert ? 'bg-red-500/10 border border-red-500/20' : 'bg-slate-900/50 print:bg-gray-50'
    }`}>
      <p className={`text-lg font-bold ${alert ? 'text-red-400 print:text-red-600' : 'text-white print:text-black'}`}>{value}</p>
      <p className="text-xs text-slate-400 print:text-gray-600">{label}</p>
    </div>
  )
}
