'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Settings, Save, X, Truck, Package, DollarSign,
  Calendar, Shield, RefreshCw, CheckCircle, AlertTriangle
} from 'lucide-react'

interface ReorderSettings {
  company_id: string
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
  is_default?: boolean
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const SCHEDULE_OPTIONS = [
  { value: 'daily', label: 'Daily', deliveries: 5 },
  { value: 'twice_weekly', label: 'Twice a week', deliveries: 2 },
  { value: 'weekly', label: 'Once a week', deliveries: 1 },
  { value: 'biweekly', label: 'Every 2 weeks', deliveries: 0.5 },
  { value: 'monthly', label: 'Monthly', deliveries: 0.25 },
  { value: 'custom', label: 'Custom', deliveries: 0 },
]

interface ReorderPresetsProps {
  companyId: string
  isAdmin: boolean
  onClose: () => void
  onSaved?: () => void
}

export default function ReorderPresets({ companyId, isAdmin, onClose, onSaved }: ReorderPresetsProps) {
  const [settings, setSettings] = useState<ReorderSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applyToAll, setApplyToAll] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    fetchSettings()
  }, [companyId])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/company/reorder-settings?companyId=${companyId}`)
      if (!res.ok) throw new Error('Failed to load settings')
      const data = await res.json()
      setSettings(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!settings || !isAdmin) return
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch('/api/company/reorder-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          company_id: companyId,
          apply_to_all_products: applyToAll
        })
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error) }
      setSaved(true)
      onSaved?.()
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const update = (field: keyof ReorderSettings, value: any) => {
    if (!settings) return
    setSettings({ ...settings, [field]: value })
  }

  const handleScheduleChange = (schedule: string) => {
    const option = SCHEDULE_OPTIONS.find(o => o.value === schedule)
    if (!settings) return
    setSettings({
      ...settings,
      delivery_schedule: schedule,
      deliveries_per_week: schedule === 'custom' ? settings.deliveries_per_week : (option?.deliveries || 2)
    })
  }

  const toggleDeliveryDay = (day: string) => {
    if (!settings) return
    const days = settings.delivery_days || []
    const newDays = days.includes(day) ? days.filter(d => d !== day) : [...days, day]
    setSettings({ ...settings, delivery_days: newDays })
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-slate-800 rounded-xl p-8">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
          <p className="text-slate-400 mt-2">Loading presets...</p>
        </div>
      </div>
    )
  }

  if (!settings) return null

  const daysBetween = settings.deliveries_per_week > 0 ? (7 / settings.deliveries_per_week).toFixed(1) : '—'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between rounded-t-xl z-10">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            Reorder & Inventory Presets
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          )}

          {/* Section 1: Reorder Defaults */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-400" />
              Default Reorder Triggers
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Reorder Point (units)</label>
                <input type="number" min="0" step="1"
                  value={settings.default_reorder_point}
                  onChange={e => update('default_reorder_point', Number(e.target.value))}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
                <p className="text-[10px] text-slate-500 mt-0.5">Order when stock drops to this level</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Default Order Quantity</label>
                <input type="number" min="1" step="1"
                  value={settings.default_order_quantity}
                  onChange={e => update('default_order_quantity', Number(e.target.value))}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
                <p className="text-[10px] text-slate-500 mt-0.5">How many units to order per product</p>
              </div>
            </div>
          </div>

          {/* Section 2: Delivery Schedule */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-400" />
              Delivery Schedule
            </h3>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Delivery Frequency</label>
              <select value={settings.delivery_schedule}
                onChange={e => handleScheduleChange(e.target.value)}
                disabled={!isAdmin}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50">
                {SCHEDULE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {settings.delivery_schedule === 'custom' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Deliveries per Week</label>
                <input type="number" min="0.25" max="7" step="0.25"
                  value={settings.deliveries_per_week}
                  onChange={e => update('deliveries_per_week', Number(e.target.value))}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-1">Delivery Days</label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS_OF_WEEK.map(day => (
                  <button key={day}
                    onClick={() => isAdmin && toggleDeliveryDay(day)}
                    disabled={!isAdmin}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      (settings.delivery_days || []).includes(day)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                    } disabled:opacity-50`}>
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Lead Time (days)</label>
                <input type="number" min="0" step="1"
                  value={settings.lead_time_days}
                  onChange={e => update('lead_time_days', Number(e.target.value))}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
                <p className="text-[10px] text-slate-500 mt-0.5">Days from order to delivery</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Safety Stock (days)</label>
                <input type="number" min="0" step="1"
                  value={settings.safety_stock_days}
                  onChange={e => update('safety_stock_days', Number(e.target.value))}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
                <p className="text-[10px] text-slate-500 mt-0.5">Extra buffer beyond delivery cycle</p>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-sm">
              <p className="text-blue-300">
                With <span className="font-semibold">{settings.deliveries_per_week}x/week</span> deliveries,
                the system orders enough to cover <span className="font-semibold">{daysBetween} days</span> between
                deliveries plus <span className="font-semibold">{settings.safety_stock_days} days</span> safety stock.
              </p>
            </div>
          </div>

          {/* Section 3: Inventory Dollar Limits */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-amber-400" />
              Inventory Dollar Limits
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Min $ on Hand</label>
                <input type="number" min="0" step="100" placeholder="No minimum"
                  value={settings.min_inventory_dollars ?? ''}
                  onChange={e => update('min_inventory_dollars', e.target.value ? Number(e.target.value) : null)}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Target $ on Hand</label>
                <input type="number" min="0" step="100" placeholder="No target"
                  value={settings.target_inventory_dollars ?? ''}
                  onChange={e => update('target_inventory_dollars', e.target.value ? Number(e.target.value) : null)}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Max $ on Hand</label>
                <input type="number" min="0" step="100" placeholder="No maximum"
                  value={settings.max_inventory_dollars ?? ''}
                  onChange={e => update('max_inventory_dollars', e.target.value ? Number(e.target.value) : null)}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              Set dollar limits to cap your inventory investment. Leave blank for no limit.
            </p>
          </div>

          {/* Section 4: Order Optimization */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-purple-400" />
              Order Optimization
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Order Multiple</label>
                <input type="number" min="1" step="1"
                  value={settings.order_multiple}
                  onChange={e => update('order_multiple', Number(e.target.value))}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
                <p className="text-[10px] text-slate-500 mt-0.5">Round up orders to this multiple</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Min Order Value ($)</label>
                <input type="number" min="0" step="10" placeholder="No minimum"
                  value={settings.min_order_value ?? ''}
                  onChange={e => update('min_order_value', e.target.value ? Number(e.target.value) : null)}
                  disabled={!isAdmin}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50" />
                <p className="text-[10px] text-slate-500 mt-0.5">Minimum $ per order to place</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={settings.consolidate_orders}
                onChange={e => update('consolidate_orders', e.target.checked)}
                disabled={!isAdmin}
                className="rounded border-slate-600 bg-slate-900 text-blue-500" />
              Consolidate items into single vendor orders
            </label>
          </div>

          {/* Apply to all */}
          {isAdmin && (
            <label className="flex items-center gap-2 text-sm text-amber-300 cursor-pointer bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <input type="checkbox" checked={applyToAll}
                onChange={e => setApplyToAll(e.target.checked)}
                className="rounded border-amber-600 bg-slate-900 text-amber-500" />
              Apply reorder point & order quantity to all existing products
            </label>
          )}

          {/* Save */}
          {isAdmin && (
            <div className="flex items-center justify-between pt-2">
              {saved && (
                <span className="flex items-center gap-1 text-sm text-emerald-400">
                  <CheckCircle className="w-4 h-4" /> Saved
                </span>
              )}
              {!saved && <span />}
              <div className="flex gap-2">
                <button onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  <Save className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
                  {saving ? 'Saving...' : 'Save Presets'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
