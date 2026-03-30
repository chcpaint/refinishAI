'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Activity, Shield, ArrowLeft, RefreshCw,
  CheckCircle, XCircle, AlertTriangle, Cpu,
  Zap, Clock, Database, TrendingUp,
  ChevronDown, ChevronRight, Brain,
  DollarSign, BarChart3, Eye
} from 'lucide-react'
import Link from 'next/link'

interface ActivitySummary {
  totalActivities: number
  periodDays: number
  byActivityType: Record<string, number>
  byComputationType: Record<string, number>
  byMethod: Record<string, number>
  baseCalculationRate: number
  insufficientDataRate: number
  llmUsageRate: number
  errorRate: number
}

interface LLMSummary {
  totalCalls: number
  totalTokens: number
  totalCostUsd: number
  avgLatencyMs: number
  byProvider: Record<string, { calls: number; tokens: number; cost: number }>
  byModel: Record<string, { calls: number; tokens: number; cost: number }>
  recentCalls: any[]
}

interface LogEntry {
  id: string
  company_id: string
  company_name: string
  activity_type: string
  method: string
  computation_type: string
  input_invoice_count: number
  input_consumption_count: number
  input_product_count: number
  data_period_days: number
  confidence_score: number | null
  llm_provider: string | null
  llm_model: string | null
  llm_total_tokens: number | null
  llm_latency_ms: number | null
  llm_cost_usd: number | null
  result_status: string
  result_summary: string | null
  error_message: string | null
  execution_time_ms: number | null
  created_at: string
}

interface ActivityData {
  summary: ActivitySummary
  llm: LLMSummary
  recentLogs: LogEntry[]
  pagination: { page: number; pageSize: number; total: number }
  generatedAt: string
}

const ACTIVITY_TYPE_LABELS: Record<string, { label: string; color: string; icon: any }> = {
  base_calculation: { label: 'Base Calculation', color: 'text-emerald-400', icon: Cpu },
  insufficient_data: { label: 'Insufficient Data', color: 'text-amber-400', icon: AlertTriangle },
  llm_forecast: { label: 'LLM Forecast', color: 'text-purple-400', icon: Brain },
  llm_recommendation: { label: 'LLM Recommendation', color: 'text-purple-400', icon: Brain },
  llm_analysis: { label: 'LLM Analysis', color: 'text-purple-400', icon: Brain },
  fallback_stale_data: { label: 'Stale Data Fallback', color: 'text-orange-400', icon: Clock },
  fallback_no_data: { label: 'No Data Fallback', color: 'text-red-400', icon: Database },
  error: { label: 'Error', color: 'text-red-500', icon: XCircle },
}

const COMPUTATION_LABELS: Record<string, { label: string; color: string }> = {
  rule_based: { label: 'Rule-Based', color: 'bg-blue-500/20 text-blue-400' },
  statistical: { label: 'Statistical', color: 'bg-emerald-500/20 text-emerald-400' },
  llm_assisted: { label: 'LLM-Assisted', color: 'bg-purple-500/20 text-purple-400' },
  hybrid: { label: 'Hybrid', color: 'bg-amber-500/20 text-amber-400' },
}

const STATUS_COLORS: Record<string, string> = {
  success: 'text-emerald-400',
  partial: 'text-amber-400',
  failed: 'text-red-400',
  rejected: 'text-orange-400',
}

export default function ActivityPage() {
  const [data, setData] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periodDays, setPeriodDays] = useState(30)
  const [authorized, setAuthorized] = useState(false)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError('Not authenticated'); setLoading(false); return }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      if (profile?.role !== 'super_admin') { setError('Access denied — super_admin only'); setLoading(false); return }
      setAuthorized(true)
    }
    checkAuth()
  }, [])

  const fetchActivity = useCallback(async () => {
    if (!authorized) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/activity?periodDays=${periodDays}`)
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to fetch') }
      setData(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [authorized, periodDays])

  useEffect(() => { fetchActivity() }, [fetchActivity])

  if (!authorized && !loading) {
    return (
      <div className="p-8 text-center">
        <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
        <p className="text-slate-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/admin" className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Activity className="w-6 h-6 text-blue-400" />
              AI Engine Activity
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Transparency reporting — every calculation, fallback, and LLM call
            </p>
          </div>
        </div>
        <button onClick={fetchActivity} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 w-fit">
        {[7, 14, 30, 60, 90].map((d) => (
          <button key={d} onClick={() => setPeriodDays(d)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              periodDays === d ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}>
            {d}d
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
          <span className="ml-3 text-slate-400">Loading activity data...</span>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">{error}</div>
      )}

      {data && !loading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPICard label="Total Activities" value={data.summary.totalActivities} icon={Activity} color="text-blue-400" />
            <KPICard label="Base Calculation Rate" value={`${data.summary.baseCalculationRate}%`} icon={Cpu} color="text-emerald-400" />
            <KPICard label="Insufficient Data Rate" value={`${data.summary.insufficientDataRate}%`} icon={AlertTriangle} color="text-amber-400" />
            <KPICard label="LLM Usage Rate" value={`${data.summary.llmUsageRate}%`} icon={Brain} color="text-purple-400" />
          </div>

          {/* Computation Transparency */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Activity Type */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-amber-400" />
                Activity Breakdown
              </h2>
              <div className="space-y-3">
                {Object.entries(data.summary.byActivityType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => {
                    const config = ACTIVITY_TYPE_LABELS[type] || { label: type, color: 'text-slate-400', icon: Activity }
                    const Icon = config.icon
                    const pct = data.summary.totalActivities > 0
                      ? Math.round((count / data.summary.totalActivities) * 100)
                      : 0
                    return (
                      <div key={type} className="flex items-center gap-3">
                        <Icon className={`w-4 h-4 ${config.color} shrink-0`} />
                        <div className="flex-1">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-slate-300">{config.label}</span>
                            <span className={config.color}>{count} ({pct}%)</span>
                          </div>
                          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${
                              type === 'base_calculation' ? 'bg-emerald-500' :
                              type === 'insufficient_data' ? 'bg-amber-500' :
                              type.startsWith('llm') ? 'bg-purple-500' :
                              type === 'error' ? 'bg-red-500' : 'bg-slate-500'
                            }`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                {Object.keys(data.summary.byActivityType).length === 0 && (
                  <p className="text-slate-500 text-sm">No activity recorded yet</p>
                )}
              </div>
            </div>

            {/* By Computation Type */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-blue-400" />
                Computation Methods
              </h2>
              <div className="space-y-3">
                {Object.entries(data.summary.byComputationType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => {
                    const config = COMPUTATION_LABELS[type] || { label: type, color: 'bg-slate-500/20 text-slate-400' }
                    const pct = data.summary.totalActivities > 0
                      ? Math.round((count / data.summary.totalActivities) * 100)
                      : 0
                    return (
                      <div key={type} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.color}`}>
                            {config.label}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-white font-semibold">{count}</span>
                          <span className="text-slate-500 text-sm ml-1">({pct}%)</span>
                        </div>
                      </div>
                    )
                  })}
                {Object.keys(data.summary.byComputationType).length === 0 && (
                  <p className="text-slate-500 text-sm">No computation data yet</p>
                )}
              </div>

              {/* Method breakdown */}
              <h3 className="text-sm font-medium text-slate-400 mt-5 mb-3">By Engine Method</h3>
              <div className="space-y-2">
                {Object.entries(data.summary.byMethod)
                  .sort(([, a], [, b]) => b - a)
                  .map(([method, count]) => (
                    <div key={method} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300 font-mono text-xs">{method}</span>
                      <span className="text-slate-400">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* LLM Transparency Section */}
          <div className="bg-slate-800/50 border border-purple-500/30 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-400" />
              LLM / AI Model Usage
              <span className="text-xs font-normal text-slate-500 ml-2">Full transparency for clients</span>
            </h2>

            {data.llm.totalCalls === 0 ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">No LLM calls in this period</span>
                </div>
                <p className="text-slate-400 text-sm mt-2">
                  All {data.summary.totalActivities} calculations used deterministic, rule-based or statistical methods.
                  No external AI models (Claude, GPT, etc.) were invoked. Every result is reproducible from the source data.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MiniStat label="LLM Calls" value={data.llm.totalCalls.toString()} />
                  <MiniStat label="Total Tokens" value={data.llm.totalTokens.toLocaleString()} />
                  <MiniStat label="Total Cost" value={`$${data.llm.totalCostUsd.toFixed(4)}`} />
                  <MiniStat label="Avg Latency" value={`${data.llm.avgLatencyMs}ms`} />
                </div>

                {/* By provider */}
                {Object.entries(data.llm.byProvider).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-400 mb-2">By Provider</h3>
                    <div className="space-y-1">
                      {Object.entries(data.llm.byProvider).map(([provider, stats]) => (
                        <div key={provider} className="flex items-center justify-between bg-slate-900/50 rounded p-2 text-sm">
                          <span className="text-purple-300 font-medium">{provider}</span>
                          <span className="text-slate-400">
                            {stats.calls} calls · {stats.tokens.toLocaleString()} tokens · ${stats.cost.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent LLM calls */}
                {data.llm.recentCalls.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-slate-400 mb-2">Recent LLM Calls</h3>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {data.llm.recentCalls.map((call, i) => (
                        <div key={i} className="bg-slate-900/50 rounded p-2 text-xs">
                          <div className="flex justify-between text-slate-400">
                            <span>{call.llm_model} via {call.llm_provider}</span>
                            <span>{new Date(call.created_at).toLocaleString()}</span>
                          </div>
                          {call.result_summary && (
                            <p className="text-slate-500 mt-1 truncate">{call.result_summary}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recent Activity Log */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Eye className="w-5 h-5 text-blue-400" />
              Recent Activity Log
              <span className="text-sm font-normal text-slate-500 ml-2">
                Showing {data.recentLogs.length} of {data.pagination.total}
              </span>
            </h2>

            {data.recentLogs.length === 0 ? (
              <p className="text-slate-500 text-sm">No activity recorded in this period. Activity will appear here once the AI engine processes calculations.</p>
            ) : (
              <div className="space-y-2">
                {data.recentLogs.map((log) => {
                  const typeConfig = ACTIVITY_TYPE_LABELS[log.activity_type] || { label: log.activity_type, color: 'text-slate-400', icon: Activity }
                  const TypeIcon = typeConfig.icon
                  const compConfig = COMPUTATION_LABELS[log.computation_type] || { label: log.computation_type, color: 'bg-slate-500/20 text-slate-400' }
                  const isExpanded = expandedLog === log.id

                  return (
                    <div key={log.id} className="bg-slate-900/50 border border-slate-700/50 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedLog(isExpanded ? null : log.id)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-slate-800/50 transition-colors text-left"
                      >
                        <TypeIcon className={`w-4 h-4 ${typeConfig.color} shrink-0`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-sm font-medium">{typeConfig.label}</span>
                            <span className="font-mono text-xs text-slate-500">{log.method}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${compConfig.color}`}>
                              {compConfig.label}
                            </span>
                            <span className={`text-xs ${STATUS_COLORS[log.result_status] || 'text-slate-400'}`}>
                              {log.result_status}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                            <span>{log.company_name}</span>
                            <span>{new Date(log.created_at).toLocaleString()}</span>
                            {log.execution_time_ms && <span>{log.execution_time_ms}ms</span>}
                          </div>
                        </div>
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3 border-t border-slate-700/50 pt-3 space-y-2">
                          {log.result_summary && (
                            <div>
                              <span className="text-xs text-slate-500">Result:</span>
                              <p className="text-sm text-slate-300 mt-0.5">{log.result_summary}</p>
                            </div>
                          )}
                          {log.error_message && (
                            <div>
                              <span className="text-xs text-red-400">Error:</span>
                              <p className="text-sm text-red-300 mt-0.5">{log.error_message}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div className="bg-slate-800 rounded p-2">
                              <span className="text-slate-500">Invoices</span>
                              <p className="text-white font-medium">{log.input_invoice_count}</p>
                            </div>
                            <div className="bg-slate-800 rounded p-2">
                              <span className="text-slate-500">Consumption</span>
                              <p className="text-white font-medium">{log.input_consumption_count}</p>
                            </div>
                            <div className="bg-slate-800 rounded p-2">
                              <span className="text-slate-500">Products</span>
                              <p className="text-white font-medium">{log.input_product_count}</p>
                            </div>
                            <div className="bg-slate-800 rounded p-2">
                              <span className="text-slate-500">Confidence</span>
                              <p className="text-white font-medium">{log.confidence_score ? `${log.confidence_score}%` : '—'}</p>
                            </div>
                          </div>
                          {log.llm_provider && (
                            <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2 text-xs">
                              <span className="text-purple-400 font-medium">LLM: </span>
                              <span className="text-slate-300">
                                {log.llm_model} via {log.llm_provider} · {log.llm_total_tokens?.toLocaleString()} tokens ·
                                {log.llm_latency_ms}ms · ${log.llm_cost_usd?.toFixed(4)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500 text-center">
            Generated {new Date(data.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  )
}

function KPICard({ label, value, icon: Icon, color }: { label: string; value: string | number; color: string; icon: any }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        {label}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900/50 rounded-lg p-2 text-center">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-white mt-0.5">{value}</div>
    </div>
  )
}
