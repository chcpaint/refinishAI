// AI Activity Logger
// Tracks every calculation, fallback, and LLM call for transparency reporting

import { SupabaseClient } from '@supabase/supabase-js'

export type ActivityType =
  | 'base_calculation'
  | 'insufficient_data'
  | 'llm_forecast'
  | 'llm_recommendation'
  | 'llm_analysis'
  | 'fallback_stale_data'
  | 'fallback_no_data'
  | 'error'

export type MethodName =
  | 'generateProjection'
  | 'analyzeWaste'
  | 'analyzeConsumptionPatterns'
  | 'generateCategoryBreakdown'
  | 'generateRecommendations'
  | 'other'

export type ComputationType =
  | 'rule_based'
  | 'statistical'
  | 'llm_assisted'
  | 'hybrid'

export type ResultStatus = 'success' | 'partial' | 'failed' | 'rejected'

export interface ActivityLogEntry {
  company_id: string
  user_id?: string
  activity_type: ActivityType
  method: MethodName
  computation_type: ComputationType
  input_invoice_count?: number
  input_consumption_count?: number
  input_product_count?: number
  data_period_days?: number
  confidence_score?: number
  llm_provider?: string
  llm_model?: string
  llm_prompt_tokens?: number
  llm_completion_tokens?: number
  llm_total_tokens?: number
  llm_latency_ms?: number
  llm_cost_usd?: number
  result_status: ResultStatus
  result_summary?: string
  error_message?: string
  execution_time_ms?: number
  metadata?: Record<string, any>
}

export class AIActivityLogger {
  private supabase: SupabaseClient

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase
  }

  // Log an activity — fire-and-forget, never blocks the engine
  async log(entry: ActivityLogEntry): Promise<void> {
    try {
      await this.supabase
        .from('ai_activity_log')
        .insert(entry)
    } catch (err) {
      // Never let logging failure break the engine
      console.error('[AIActivityLogger] Failed to write log:', err)
    }
  }

  // Convenience: wrap a method call with automatic timing + logging
  async trackExecution<T>(
    companyId: string,
    method: MethodName,
    computationType: ComputationType,
    dataContext: {
      invoiceCount?: number
      consumptionCount?: number
      productCount?: number
      periodDays?: number
    },
    fn: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now()
    try {
      const result = await fn()
      const executionTime = Date.now() - startTime

      // Determine activity type and status from result
      let activityType: ActivityType = 'base_calculation'
      let resultStatus: ResultStatus = 'success'
      let resultSummary = `${method} completed in ${executionTime}ms`

      // Check for insufficient data result
      if (result && typeof result === 'object' && 'insufficient_data' in result) {
        activityType = 'insufficient_data'
        resultStatus = 'rejected'
        resultSummary = (result as any).message || 'Insufficient data'
      }

      await this.log({
        company_id: companyId,
        activity_type: activityType,
        method,
        computation_type: computationType,
        input_invoice_count: dataContext.invoiceCount || 0,
        input_consumption_count: dataContext.consumptionCount || 0,
        input_product_count: dataContext.productCount || 0,
        data_period_days: dataContext.periodDays || 0,
        confidence_score: result && typeof result === 'object' && 'confidence' in result
          ? (result as any).confidence
          : undefined,
        result_status: resultStatus,
        result_summary: resultSummary,
        execution_time_ms: executionTime
      })

      return result
    } catch (error: any) {
      const executionTime = Date.now() - startTime
      await this.log({
        company_id: companyId,
        activity_type: 'error',
        method,
        computation_type: computationType,
        input_invoice_count: dataContext.invoiceCount || 0,
        input_consumption_count: dataContext.consumptionCount || 0,
        input_product_count: dataContext.productCount || 0,
        data_period_days: dataContext.periodDays || 0,
        result_status: 'failed',
        result_summary: `${method} failed after ${executionTime}ms`,
        error_message: error.message || String(error),
        execution_time_ms: executionTime
      })
      throw error // Re-throw so the engine still surfaces the error
    }
  }

  // Log LLM-specific activity
  async logLLMCall(
    companyId: string,
    method: MethodName,
    llmDetails: {
      provider: string
      model: string
      promptTokens: number
      completionTokens: number
      latencyMs: number
      costUsd?: number
    },
    resultSummary: string
  ): Promise<void> {
    await this.log({
      company_id: companyId,
      activity_type: 'llm_forecast',
      method,
      computation_type: 'llm_assisted',
      llm_provider: llmDetails.provider,
      llm_model: llmDetails.model,
      llm_prompt_tokens: llmDetails.promptTokens,
      llm_completion_tokens: llmDetails.completionTokens,
      llm_total_tokens: llmDetails.promptTokens + llmDetails.completionTokens,
      llm_latency_ms: llmDetails.latencyMs,
      llm_cost_usd: llmDetails.costUsd,
      result_status: 'success',
      result_summary: resultSummary
    })
  }
}
