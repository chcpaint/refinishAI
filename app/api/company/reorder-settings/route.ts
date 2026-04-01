import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// Company Reorder Settings API — admin/super_admin only
// GET: fetch settings for current company
// PUT: update settings

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, company_id')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    // Allow specifying company_id for super_admin
    const searchParams = request.nextUrl.searchParams
    const companyId = (profile.role === 'super_admin' && searchParams.get('companyId'))
      ? searchParams.get('companyId')!
      : profile.company_id

    const { data: settings } = await supabase
      .from('company_reorder_settings')
      .select('*')
      .eq('company_id', companyId)
      .single()

    if (!settings) {
      // Return defaults if no settings exist yet
      return NextResponse.json({
        company_id: companyId,
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
        consolidate_orders: true,
        is_default: true
      })
    }

    return NextResponse.json(settings)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, company_id')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden — admin or super_admin required' }, { status: 403 })
    }

    const body = await request.json()
    const companyId = (profile.role === 'super_admin' && body.company_id)
      ? body.company_id
      : profile.company_id

    // Validate inputs
    const updates = {
      company_id: companyId,
      default_reorder_point: Math.max(0, Number(body.default_reorder_point) || 3),
      default_order_quantity: Math.max(1, Number(body.default_order_quantity) || 4),
      deliveries_per_week: Math.max(0.5, Math.min(7, Number(body.deliveries_per_week) || 2)),
      delivery_schedule: body.delivery_schedule || 'twice_weekly',
      delivery_days: body.delivery_days || ['Tuesday', 'Thursday'],
      lead_time_days: Math.max(0, Number(body.lead_time_days) || 1),
      max_inventory_dollars: body.max_inventory_dollars ? Number(body.max_inventory_dollars) : null,
      min_inventory_dollars: body.min_inventory_dollars ? Number(body.min_inventory_dollars) : null,
      target_inventory_dollars: body.target_inventory_dollars ? Number(body.target_inventory_dollars) : null,
      safety_stock_days: Math.max(0, Number(body.safety_stock_days) || 2),
      safety_stock_method: body.safety_stock_method || 'days_of_supply',
      safety_stock_value: Math.max(0, Number(body.safety_stock_value) || 2),
      order_multiple: Math.max(1, Number(body.order_multiple) || 1),
      min_order_value: body.min_order_value ? Number(body.min_order_value) : null,
      consolidate_orders: body.consolidate_orders !== false,
      updated_at: new Date().toISOString(),
      updated_by: user.id
    }

    const { data, error } = await supabase
      .from('company_reorder_settings')
      .upsert(updates, { onConflict: 'company_id' })
      .select()
      .single()

    if (error) throw error

    // Optionally apply default_reorder_point and default_order_quantity
    // to all inventory_stock rows that still have old defaults
    if (body.apply_to_all_products) {
      await supabase
        .from('inventory_stock')
        .update({
          reorder_point: updates.default_reorder_point,
          reorder_quantity: updates.default_order_quantity,
          last_updated: new Date().toISOString()
        })
        .eq('shop_id', companyId)
    }

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
