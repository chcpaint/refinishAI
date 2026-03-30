'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  BarChart3, TrendingUp, TrendingDown, Minus,
  Globe, MapPin, Building2, RefreshCw,
  Shield, ArrowLeft, DollarSign, Percent,
  Clock, Package, AlertTriangle, ChevronDown
} from 'lucide-react'
import Link from 'next/link'

interface BenchmarkMetric {
  best: number
  mean: number
  worst: number
}

interface BenchmarkGroup {
  groupKey: string
  groupLabel: string
  companyCount: number
  metrics: {
    avgInvoiceTotal: BenchmarkMetric
    avgMaterialCost: BenchmarkMetric
    avgLaborCost: BenchmarkMetric
    wastePercent: BenchmarkMetric
    avgPartsPerJob: BenchmarkMetric
    avgCycleTimeDays: BenchmarkMetric
    avgVariancePct: BenchmarkMetric
  }
}

interface BenchmarkData {
  benchmarks: BenchmarkGroup[]
  overall: BenchmarkGroup | null
  periodDays: number
  groupBy: string
  totalCompanies: number
  generatedAt: string
}

const METRIC_CONFIG = [
  { key: 'avgInvoiceTotal', label: 'Avg Invoice Total', icon: DollarSign, format: 'currency', lowerIsBetter: false },
  { key: 'avgMaterialCost', label: 'Avg Material Cost', icon: DollarSign, format: 'currency', lowerIsBetter: true },
  { key: 'avgLaborCost', label: 'Avg Labor Cost', icon: DollarSign, format: 'currency', lowerIsBetter: true },
  { key: 'wastePercent', label: 'Waste %', icon: Percent, format: 'percent', lowerIsBetter: true },
  { key: 'avgPartsPerJob', label: 'Avg Parts/Job', icon: Package, format: 'number', lowerIsBetter: false },
  { key: 'avgCycleTimeDays', label: 'Avg Cycle Time', icon: Clock, format: 'days', lowerIsBetter: true },
  { key: 'avgVariancePct', label: 'Avg Variance %', icon: AlertTriangle, format: 'percent', lowerIsBetter: true },
] as const

function formatValue(value: number, format: string): string {
  switch (format) {
    case 'currency': return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'percent': return `${value.toFixed(1)}%`
    case 'days': return `${value.toFixed(1)} days`
    case 'number': return value.toFixed(1)
    default: return value.toString()
  }
}

export default function BenchmarksPage() {
  const [data, setData] = useState<BenchmarkData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<'all' | 'state' | 'city'>('all')
  const [periodDays, setPeriodDays] = useState(90)
  const [authorized, setAuthorized] = useState(false)

  const supabase = createClient()

  // Check super_admin access
  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Not authenticated')
        setLoading(false)
        return
      }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'super_admin') {
        setError('Access denied — super_admin only')
        setLoading(false)
        return
      }
      setAuthorized(true)
    }
    checkAuth()
  }, [])

  const fetchBenchmarks = useCallback(async () => {
    if (!authorized) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/benchmarks?groupBy=${groupBy}&periodDays=${periodDays}`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to fetch benchmarks')
      }
      const json = await res.json()
      setData(json)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [authorized, groupBy, periodDays])

  useEffect(() => {
    fetchBenchmarks()
  }, [fetchBenchmarks])

  if (!authorized && !loading) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
        <p className="text-slate-400">{error || 'Super admin access required.'}</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/admin"
            className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-400" />
              Industry Benchmarks
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Anonymized performance data across all companies
            </p>
          </div>
        </div>
        <button
          onClick={fetchBenchmarks}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1">
          {(['all', 'state', 'city'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                groupBy === g
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {g === 'all' && <Globe className="w-3.5 h-3.5" />}
              {g === 'state' && <MapPin className="w-3.5 h-3.5" />}
              {g === 'city' && <Building2 className="w-3.5 h-3.5" />}
              {g === 'all' ? 'All' : g === 'state' ? 'By State/Province' : 'By City'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1">
          {[30, 60, 90, 180, 365].map((d) => (
            <button
              key={d}
              onClick={() => setPeriodDays(d)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                periodDays === d
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {d < 365 ? `${d}d` : '1y'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
          <span className="ml-3 text-slate-400">Aggregating benchmark data...</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* Data */}
      {data && !loading && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard
              label="Companies Tracked"
              value={data.totalCompanies.toString()}
              icon={Building2}
            />
            <SummaryCard
              label="Period"
              value={`${data.periodDays} days`}
              icon={Clock}
            />
            <SummaryCard
              label="Grouped By"
              value={data.groupBy === 'all' ? 'Overall' : data.groupBy === 'state' ? 'State/Province' : 'City'}
              icon={MapPin}
            />
            <SummaryCard
              label="Regions"
              value={data.benchmarks.length.toString()}
              icon={Globe}
            />
          </div>

          {/* Overall Benchmarks */}
          {data.overall && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Globe className="w-5 h-5 text-blue-400" />
                Overall Industry Benchmarks
                <span className="text-sm font-normal text-slate-400 ml-2">
                  ({data.overall.companyCount} companies)
                </span>
              </h2>
              <MetricsGrid group={data.overall} />
            </div>
          )}

          {/* Regional Breakdowns */}
          {data.benchmarks.length > 0 && groupBy !== 'all' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <MapPin className="w-5 h-5 text-emerald-400" />
                Regional Breakdown
              </h2>
              {data.benchmarks.map((group) => (
                <RegionCard key={group.groupKey} group={group} />
              ))}
            </div>
          )}

          {/* Generated timestamp */}
          <p className="text-xs text-slate-500 text-center">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

function MetricsGrid({ group }: { group: BenchmarkGroup }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {METRIC_CONFIG.map((cfg) => {
        const metric = group.metrics[cfg.key as keyof typeof group.metrics]
        if (!metric || (metric.best === 0 && metric.mean === 0 && metric.worst === 0)) return null
        const Icon = cfg.icon

        return (
          <div key={cfg.key} className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs font-medium mb-2">
              <Icon className="w-3.5 h-3.5" />
              {cfg.label}
            </div>
            <div className="space-y-1.5">
              <MetricRow
                label="Best"
                value={formatValue(metric.best, cfg.format)}
                color="text-emerald-400"
                icon={TrendingUp}
              />
              <MetricRow
                label="Mean"
                value={formatValue(metric.mean, cfg.format)}
                color="text-blue-400"
                icon={Minus}
              />
              <MetricRow
                label="Worst"
                value={formatValue(metric.worst, cfg.format)}
                color="text-red-400"
                icon={TrendingDown}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MetricRow({ label, value, color, icon: Icon }: {
  label: string; value: string; color: string; icon: any
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <Icon className={`w-3 h-3 ${color}`} />
        {label}
      </span>
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
    </div>
  )
}

function RegionCard({ group }: { group: BenchmarkGroup }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <MapPin className="w-5 h-5 text-emerald-400" />
          <span className="text-white font-medium">{group.groupLabel}</span>
          <span className="text-sm text-slate-400">
            ({group.companyCount} {group.companyCount === 1 ? 'company' : 'companies'})
          </span>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="p-4 pt-0">
          <MetricsGrid group={group} />
        </div>
      )}
    </div>
  )
}
