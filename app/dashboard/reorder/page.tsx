'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Package, AlertTriangle, Clock, Download, Printer, RefreshCw,
  Filter, ChevronDown, ChevronUp, Search, FileSpreadsheet, FileText,
  CheckCircle, AlertCircle, Info, ShoppingCart, Truck, MapPin,
  Save, X, Shield, Settings
} from 'lucide-react'
import ReorderPresets from '@/components/ReorderPresets'
import {
  ReorderReportService,
  type ReorderReport,
  type ReorderItem,
  type ReorderReportOptions
} from '@/lib/reports/reorder-report'
import { getPaintLineFilter, type PaintLineFilter } from '@/lib/services/paint-line-filter'
import { createPurchaseOrderService } from '@/lib/services/purchase-order-service'
import { generateReorderPDF } from '@/lib/reports/pdf-export'
import { generateReorderXLSX } from '@/lib/reports/excel-export'
import OrderHistory from './order-history'

type PageTab = 'current' | 'history'

export default function ReorderReportPage() {
  const supabase = createClient()
  const [service] = useState(() => new ReorderReportService(supabase))

  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<ReorderReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyInfo, setCompanyInfo] = useState<{ name: string; address?: string; city?: string; state?: string; zip?: string; phone?: string }>({ name: '' })

  // Paint line filter
  const [paintFilter, setPaintFilter] = useState<PaintLineFilter | null>(null)

  // Page tabs
  const [activeTab, setActiveTab] = useState<PageTab>('current')

  // Filters
  const [showFilters, setShowFilters] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<string[]>(['critical', 'urgent', 'normal'])
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [supplierFilter, setSupplierFilter] = useState<string>('')
  const [showOptional, setShowOptional] = useState(false)

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Edit mode for adjustments
  const [adjustments, setAdjustments] = useState<Record<string, number>>({})

  // Save PO modal
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [poNotes, setPoNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  // Reorder presets
  const [showPresets, setShowPresets] = useState(false)
  const [userRole, setUserRole] = useState<string>('staff')

  useEffect(() => {
    loadReport()
  }, [])

  const loadReport = async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role, company_id, companies(name, address, city, state, zip, phone)')
        .eq('id', user.id)
        .single()

      if (!profile?.company_id) throw new Error('No company found')
      setCompanyId(profile.company_id)
      setUserRole(profile.role || 'staff')

      const co = profile.companies as any
      const coData = Array.isArray(co) ? co[0] : co
      setCompanyInfo({
        name: coData?.name || '',
        address: coData?.address || '',
        city: coData?.city || '',
        state: coData?.state || '',
        zip: coData?.zip || '',
        phone: coData?.phone || '',
      })

      // Get paint line filter
      const filter = await getPaintLineFilter(supabase, profile.company_id)
      setPaintFilter(filter)

      const options: ReorderReportOptions = {
        includeOptional: showOptional,
        priorityFilter: priorityFilter as any[]
      }

      // Pass paint line filter to service
      const reportData = await service.generateReport(profile.company_id, options, filter)
      setReport(reportData)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    loadReport()
  }

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  const handleAdjustment = (itemId: string, value: number) => {
    setAdjustments(prev => ({ ...prev, [itemId]: value }))
  }

  const getAdjustedQty = (item: ReorderItem): number => {
    return adjustments[item.id] ?? item.suggestedOrderQty
  }

  const getTotalCost = (): number => {
    if (!report) return 0
    return filteredItems.reduce((sum, item) => {
      const qty = getAdjustedQty(item)
      return sum + (qty * item.unitCost)
    }, 0)
  }

  // ─── EXPORT FUNCTIONS ───

  const exportCSV = () => {
    if (!report) return
    const csv = service.generateCSV(report)
    const blob = new Blob([csv], { type: 'text/csv' })
    downloadBlob(blob, `reorder-report-${new Date().toISOString().split('T')[0]}.csv`)
  }

  const printReport = () => {
    if (!report) return
    const html = service.generatePrintableHTML(report)
    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(html)
      printWindow.document.close()
    }
  }

  const exportPDF = () => {
    if (!report) return
    try {
      const blob = generateReorderPDF(report, companyInfo, adjustments)
      downloadBlob(blob, `purchase-order-report-${new Date().toISOString().split('T')[0]}.pdf`)
    } catch (err) {
      console.error('PDF export failed:', err)
    }
  }

  const exportXLSX = () => {
    if (!report) return
    try {
      const blob = generateReorderXLSX(report, companyInfo, adjustments)
      downloadBlob(blob, `purchase-order-report-${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (err) {
      console.error('XLSX export failed:', err)
    }
  }

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── SAVE PURCHASE ORDER ───

  const handleSavePO = async () => {
    if (!report || !companyId) return
    setSaving(true)
    try {
      const poService = createPurchaseOrderService(supabase)
      const result = await poService.savePurchaseOrder(
        companyId,
        filteredItems,
        adjustments,
        poNotes || undefined,
        paintFilter?.primaryVendor?.vendorCode,
        paintFilter?.primaryVendor?.vendorName
      )
      if (result.success) {
        setSaveSuccess(result.poNumber || 'saved')
        setShowSaveModal(false)
        setPoNotes('')
        // Switch to history tab after short delay
        setTimeout(() => {
          setActiveTab('history')
          setSaveSuccess(null)
        }, 2000)
      } else {
        setError(result.error || 'Failed to save purchase order')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Filter items
  const filteredItems = (report?.items || []).filter(item => {
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      if (!item.productName.toLowerCase().includes(search) &&
          !item.sku.toLowerCase().includes(search) &&
          !(item.supplierName?.toLowerCase().includes(search)) &&
          !(item.manufacturer?.toLowerCase().includes(search))) {
        return false
      }
    }
    if (priorityFilter.length && !priorityFilter.includes(item.priority)) {
      return false
    }
    if (categoryFilter && item.category !== categoryFilter) {
      return false
    }
    if (supplierFilter && item.supplierName !== supplierFilter) {
      return false
    }
    if (!showOptional && item.priority === 'optional') {
      return false
    }
    return true
  })

  // Get unique categories and suppliers
  const categories = Array.from(new Set(report?.items.map(i => i.category) || []))
  const suppliers = Array.from(new Set(report?.items.map(i => i.supplierName).filter(Boolean) || []))

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      critical: 'bg-red-100 text-red-700 border-red-200',
      urgent: 'bg-amber-100 text-amber-700 border-amber-200',
      normal: 'bg-blue-100 text-blue-700 border-blue-200',
      optional: 'bg-gray-100 text-gray-600 border-gray-200'
    }
    const icons: Record<string, any> = {
      critical: <AlertCircle className="w-3 h-3" />,
      urgent: <AlertTriangle className="w-3 h-3" />,
      normal: <Clock className="w-3 h-3" />,
      optional: <Info className="w-3 h-3" />
    }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${styles[priority]}`}>
        {icons[priority]}
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Generating reorder report...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 px-6 py-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <ShoppingCart className="w-7 h-7 text-blue-400" />
                Reorder & Purchasing
                <button
                  onClick={() => setShowPresets(true)}
                  className="ml-2 p-1.5 rounded-lg bg-slate-600/50 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors"
                  title="Reorder Presets"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </h1>
              <div className="flex items-center gap-3 mt-2">
                <p className="text-slate-300 text-sm">
                  Inventory reorder recommendations and purchase order management
                </p>
                {paintFilter?.hasPaintLineContract && paintFilter.primaryVendor && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
                    <Shield className="w-3 h-3" />
                    Primary Paint Line: {paintFilter.primaryVendor.vendorName}
                  </span>
                )}
              </div>
            </div>

            {/* Tab Toggle */}
            <div className="flex gap-0 bg-slate-700 rounded-lg overflow-hidden border border-slate-600">
              <button
                onClick={() => setActiveTab('current')}
                className={`px-4 py-2 text-sm font-medium transition-all ${
                  activeTab === 'current'
                    ? 'bg-white text-blue-700 border-b-2 border-blue-600'
                    : 'text-gray-300 hover:text-gray-100'
                }`}
              >
                Current Reorder
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'bg-white text-blue-700 border-b-2 border-blue-600'
                    : 'text-gray-300 hover:text-gray-100'
                }`}
              >
                Order History
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Success Notification */}
      {saveSuccess && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          Purchase Order <strong>{saveSuccess}</strong> created successfully!
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ═══ CURRENT REORDER TAB ═══ */}
      {activeTab === 'current' && (
        <>
          {/* Action Buttons */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                  showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Filter className="w-4 h-4" />
                Filters
              </button>
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Export buttons */}
              <button
                onClick={exportPDF}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                title="Export as PDF"
              >
                <FileText className="w-4 h-4 text-red-500" />
                PDF
              </button>
              <button
                onClick={exportXLSX}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                title="Export as Excel"
              >
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                Excel
              </button>
              <button
                onClick={exportCSV}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                title="Export as CSV"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
              <button
                onClick={printReport}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                title="Print walk-around checklist"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>

              {/* Save as PO */}
              <button
                onClick={() => setShowSaveModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
              >
                <Save className="w-4 h-4" />
                Create Purchase Order
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          {report && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 text-red-600 mb-1">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Critical</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.criticalItems}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 text-amber-600 mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">Urgent</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.urgentItems}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 text-blue-600 mb-1">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-medium">Normal</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.normalItems}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <Package className="w-4 h-4" />
                    <span className="text-sm font-medium">Total SKUs</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{report.summary.totalSkusToOrder}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 text-green-600 mb-1">
                    <ShoppingCart className="w-4 h-4" />
                    <span className="text-sm font-medium">Order Items</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">{filteredItems.filter(i => i.priority !== 'optional').length}</p>
                </div>
              </div>
              <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                <div className="p-4">
                  <div className="flex items-center gap-2 text-green-600 mb-1">
                    <span className="text-sm font-medium">Est. Total</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600">${getTotalCost().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>
          )}

          {/* Filters Panel */}
          {showFilters && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Filters</h3>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="SKU, name, supplier..."
                      className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <div className="flex flex-wrap gap-2">
                    {['critical', 'urgent', 'normal'].map(p => (
                      <label key={p} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={priorityFilter.includes(p)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPriorityFilter([...priorityFilter, p])
                            } else {
                              setPriorityFilter(priorityFilter.filter(x => x !== p))
                            }
                          }}
                          className="rounded"
                        />
                        <span className="text-sm capitalize">{p}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">All Categories</option>
                    {categories.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
                  <select
                    value={supplierFilter}
                    onChange={(e) => setSupplierFilter(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">All Suppliers</option>
                    {suppliers.map(s => (
                      <option key={s} value={s || ''}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showOptional}
                      onChange={(e) => setShowOptional(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Include optional items</span>
                  </label>
                </div>
              </div>
            </div>
            </div>
          )}

          {/* Main Table */}
          {report && filteredItems.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-slate-100 border-b border-gray-200">
                    <tr>
                      <th className="w-8 px-2 py-3"></th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Priority</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">SKU</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Product</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Category</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">Bin</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">On Hand</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Min</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Par</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-blue-50">Order Qty</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Unit $</th>
                      <th className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Ext $</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Supplier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredItems.map((item) => (
                      <>
                        <tr
                          key={item.id}
                          className={`hover:bg-gray-50 cursor-pointer ${
                            item.priority === 'critical' ? 'bg-red-50/50' :
                            item.priority === 'urgent' ? 'bg-amber-50/50' : ''
                          }`}
                          onClick={() => toggleRow(item.id)}
                        >
                          <td className="px-2 py-3 text-center">
                            {expandedRows.has(item.id) ? (
                              <ChevronUp className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            )}
                          </td>
                          <td className="px-3 py-3">{getPriorityBadge(item.priority)}</td>
                          <td className="px-3 py-3 font-mono text-sm font-medium text-gray-900">{item.sku || '—'}</td>
                          <td className="px-3 py-3">
                            <div className="font-medium text-gray-900">{item.productName}</div>
                            <div className="text-xs text-gray-500">{item.priorityReason}</div>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-600">{item.category}</td>
                          <td className="px-3 py-3 text-center">
                            {item.locationBin ? (
                              <span className="inline-flex items-center gap-1 text-xs bg-gray-100 px-2 py-1 rounded">
                                <MapPin className="w-3 h-3" />
                                {item.locationBin}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`font-semibold ${
                              item.currentStock <= 0 ? 'text-red-600' :
                              item.currentStock <= item.reorderPoint ? 'text-amber-600' : 'text-gray-900'
                            }`}>
                              {item.currentStock}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-gray-600">{item.reorderPoint}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{item.parLevel}</td>
                          <td className="px-3 py-3 text-right bg-blue-50" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number"
                              min="0"
                              value={getAdjustedQty(item)}
                              onChange={(e) => handleAdjustment(item.id, parseInt(e.target.value) || 0)}
                              className="w-20 text-right border rounded px-2 py-1 font-semibold text-sm"
                            />
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-sm">${item.unitCost.toFixed(2)}</td>
                          <td className="px-3 py-3 text-right font-semibold text-green-600">
                            ${(getAdjustedQty(item) * item.unitCost).toFixed(2)}
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-600">{item.supplierName || item.manufacturer || '—'}</td>
                        </tr>

                        {/* Expanded Details Row */}
                        {expandedRows.has(item.id) && (
                          <tr key={`${item.id}-detail`} className="bg-gray-50">
                            <td colSpan={13} className="px-6 py-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
                                <div>
                                  <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                    <Package className="w-4 h-4" />
                                    Inventory Details
                                  </h4>
                                  <div className="space-y-1 text-gray-600">
                                    <div>Unit: <span className="font-medium">{item.unit}</span></div>
                                    <div>Min Order: <span className="font-medium">{item.minOrderQty}</span></div>
                                    <div>Order Multiple: <span className="font-medium">{item.orderMultiple}</span></div>
                                    <div>Days of Stock: <span className={`font-medium ${
                                      item.daysOfStockRemaining <= 3 ? 'text-red-600' :
                                      item.daysOfStockRemaining <= 7 ? 'text-amber-600' : 'text-green-600'
                                    }`}>{item.daysOfStockRemaining}</span></div>
                                  </div>
                                </div>
                                <div>
                                  <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                    <Truck className="w-4 h-4" />
                                    Supplier Info
                                  </h4>
                                  <div className="space-y-1 text-gray-600">
                                    <div>Supplier: <span className="font-medium">{item.supplierName || 'Not assigned'}</span></div>
                                    <div>Manufacturer: <span className="font-medium">{item.manufacturer || '—'}</span></div>
                                    <div>Supplier SKU: <span className="font-medium">{item.supplierSku || '—'}</span></div>
                                    <div>Lead Time: <span className="font-medium">{item.leadTimeDays} days</span></div>
                                  </div>
                                </div>
                                <div>
                                  <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-1">
                                    <Clock className="w-4 h-4" />
                                    Usage Analysis
                                  </h4>
                                  <div className="space-y-1 text-gray-600">
                                    <div>Avg Daily: <span className="font-medium">{item.avgDailyUsage}</span></div>
                                    <div>Avg Weekly: <span className="font-medium">{item.avgWeeklyUsage}</span></div>
                                    <div>Last Count: <span className="font-medium">
                                      {item.lastCountDate ? new Date(item.lastCountDate).toLocaleDateString() : 'Never'}
                                    </span></div>
                                    <div>Last Order: <span className="font-medium">
                                      {item.lastOrderDate ? new Date(item.lastOrderDate).toLocaleDateString() : 'Never'}
                                    </span></div>
                                  </div>
                                </div>
                                <div>
                                  <h4 className="font-semibold text-gray-700 mb-2">Order Calculation</h4>
                                  <div className="bg-white rounded-lg p-3 border">
                                    <div className="text-xs text-gray-500 mb-2">
                                      Par Level ({item.parLevel}) - Current ({item.currentStock}) = {item.parLevel - item.currentStock}
                                    </div>
                                    <div className="text-xs text-gray-500 mb-2">
                                      + Lead time buffer ({item.leadTimeDays} days x {item.avgDailyUsage}/day)
                                    </div>
                                    <div className="text-lg font-bold text-blue-600">
                                      Suggested: {item.suggestedOrderQty} {item.unit}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100">
                    <tr>
                      <td colSpan={9} className="px-3 py-3 text-right font-semibold">Totals:</td>
                      <td className="px-3 py-3 text-right font-bold bg-blue-100">
                        {filteredItems.reduce((sum, i) => sum + getAdjustedQty(i), 0)}
                      </td>
                      <td></td>
                      <td className="px-3 py-3 text-right font-bold text-green-600">
                        ${getTotalCost().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Empty State */}
          {report && filteredItems.length === 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-12 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Items Need Reordering</h3>
              <p className="text-gray-600">
                All inventory levels are adequate based on current consumption patterns.
              </p>
            </div>
          )}

          {/* Report Info */}
          {report && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-6 py-3.5 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Report Details</h2>
              </div>
              <div className="p-4 text-sm text-gray-600">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <strong>Report Generated:</strong> {new Date(report.generatedAt).toLocaleString()}
                  </div>
                  <div>
                    <strong>Analysis Period:</strong> {report.reportPeriod}
                  </div>
                  <div>
                    <strong>Settings:</strong> Critical ≤{report.settings.criticalThresholdDays} days,
                    Urgent ≤{report.settings.urgentThresholdDays} days,
                    Lead time buffer: {report.settings.leadTimeSafetyBuffer} days
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ ORDER HISTORY TAB ═══ */}
      {activeTab === 'history' && companyId && (
        <OrderHistory companyId={companyId} />
      )}

      {/* ═══ SAVE PO MODAL ═══ */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden border border-gray-200">
            <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Save className="w-5 h-5 text-blue-600" />
                Create Purchase Order
              </h3>
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              {/* Summary */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Items:</span>
                    <span className="ml-2 font-bold">{filteredItems.length}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Total Cost:</span>
                    <span className="ml-2 font-bold text-green-600">
                      ${getTotalCost().toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {paintFilter?.primaryVendor && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Primary Vendor:</span>
                      <span className="ml-2 font-bold">{paintFilter.primaryVendor.vendorName}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes (optional)
                </label>
                <textarea
                  value={poNotes}
                  onChange={e => setPoNotes(e.target.value)}
                  placeholder="Add any notes for this purchase order..."
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePO}
                  disabled={saving || filteredItems.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {saving ? 'Saving...' : 'Create Purchase Order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Reorder Presets Modal */}
      {showPresets && companyId && (
        <ReorderPresets
          companyId={companyId}
          isAdmin={userRole === 'admin' || userRole === 'super_admin'}
          onClose={() => setShowPresets(false)}
          onSaved={() => loadReport()}
        />
      )}
    </div>
  )
}
