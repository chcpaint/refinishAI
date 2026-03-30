'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  Shield,
  LogOut,
  Menu,
  X,
  Building2,
  BarChart3,
  DollarSign,
  ShoppingCart,
  Settings,
  HelpCircle,
  FileText,
  Receipt,
  ChevronDown,
  MoreHorizontal,
  User,
  CreditCard,
  Activity
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import CompanySwitcher from './CompanySwitcher'

interface Company {
  id: string
  name: string
  city?: string
}

interface DashboardNavProps {
  user: any
  profile: any
  companies?: Company[]
}

export default function DashboardNav({ user, profile, companies = [] }: DashboardNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const isCorporateUser = profile?.is_corporate_user === true
  const isCorporateParent = profile?.companies?.company_type === 'corporate'
  const userRole = profile?.role || 'staff'
  const isAdmin = userRole === 'admin' || userRole === 'super_admin'
  const isManager = isAdmin || userRole === 'manager'

  // Primary nav - always visible
  const primaryNav = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Inventory', href: '/dashboard/inventory', icon: Package },
    { name: 'Estimates', href: '/dashboard/estimates', icon: FileText },
    { name: 'Invoices', href: '/dashboard/invoices', icon: Receipt },
  ]

  // "More" dropdown items - role-filtered
  const moreNav = [
    { name: 'Counts', href: '/dashboard/counts', icon: ClipboardList, show: true },
    { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3, show: isManager },
    { name: 'Reorder', href: '/dashboard/reorder', icon: ShoppingCart, show: isManager },
    { name: 'Insurance', href: '/dashboard/labor-rates', icon: DollarSign, show: isAdmin },
    ...(isCorporateUser && isCorporateParent ? [
      { name: 'Corporate', href: '/dashboard/corporate', icon: Building2, show: isAdmin },
    ] : []),
  ].filter(item => item.show)

  // Check if any "More" item is active
  const moreIsActive = moreNav.some(item => pathname === item.href)

  // User menu items
  const userMenuNav = [
    { name: 'Settings', href: '/dashboard/company', icon: Settings, show: isAdmin },
    { name: 'Billing', href: '/dashboard/company/billing', icon: CreditCard, show: isAdmin },
    { name: 'Admin', href: '/dashboard/admin', icon: Shield, show: userRole === 'super_admin' },
    { name: 'Benchmarks', href: '/dashboard/admin/benchmarks', icon: BarChart3, show: userRole === 'super_admin' },
    { name: 'AI Activity', href: '/dashboard/admin/activity', icon: Activity, show: userRole === 'super_admin' },
    { name: 'Audit Export', href: '/dashboard/admin/audit-export', icon: FileText, show: userRole === 'super_admin' },
    { name: 'Help', href: '/dashboard/help', icon: HelpCircle, show: true },
  ].filter(item => item.show)

  // All items for mobile
  const allNav = [
    ...primaryNav.map(item => ({ ...item, show: true })),
    ...moreNav,
    ...userMenuNav,
  ]

  return (
    <nav className="bg-slate-900 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-end pr-1">
              <span className="text-white font-bold text-xl leading-none">R</span>
              <span className="text-blue-200 font-semibold text-[10px] leading-none mb-0.5">ai</span>
            </div>
            <div className="hidden md:block">
              <h1 className="text-lg font-bold leading-tight">
                <span className="text-white">refinish</span><span className="text-blue-400">AI</span>
              </h1>
            </div>
          </Link>

          {/* Company Switcher */}
          {companies.length > 0 && (
            <CompanySwitcher
              currentCompanyId={profile?.company_id || ''}
              currentCompanyName={profile?.companies?.name || 'No Company'}
              companies={companies}
            />
          )}

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center gap-0.5">
            {/* Primary items */}
            {primaryNav.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.name}
                </Link>
              )
            })}

            {/* More dropdown */}
            {moreNav.length > 0 && (
              <div ref={moreRef} className="relative">
                <button
                  onClick={() => { setMoreOpen(!moreOpen); setUserMenuOpen(false) }}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    moreIsActive
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                  More
                  <ChevronDown className={`w-3 h-3 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
                </button>
                {moreOpen && (
                  <div className="absolute top-full left-0 mt-1.5 w-52 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
                    {moreNav.map((item) => {
                      const Icon = item.icon
                      const isActive = pathname === item.href
                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                            isActive
                              ? 'bg-blue-50 text-blue-700 font-medium'
                              : 'text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          {item.name}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* User menu dropdown */}
            <div ref={userMenuRef} className="relative hidden lg:block">
              <button
                onClick={() => { setUserMenuOpen(!userMenuOpen); setMoreOpen(false) }}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                  userMenuOpen ? 'bg-slate-700' : 'hover:bg-slate-800'
                }`}
              >
                <div className="w-7 h-7 bg-slate-700 rounded-full flex items-center justify-center ring-2 ring-slate-600">
                  <User className="w-3.5 h-3.5 text-slate-300" />
                </div>
                <span className="hidden xl:block text-sm font-medium text-slate-300 max-w-[120px] truncate">
                  {profile?.full_name?.split(' ')[0] || 'Account'}
                </span>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {userMenuOpen && (
                <div className="absolute top-full right-0 mt-1.5 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 rounded-t-lg">
                    <p className="text-sm font-semibold text-gray-900">{profile?.full_name || user.email}</p>
                    <p className="text-xs text-gray-500 capitalize">{userRole.replace('_', ' ')}</p>
                    {profile?.companies?.name && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{profile.companies.name}</p>
                    )}
                  </div>
                  {/* Menu items */}
                  {userMenuNav.map((item) => {
                    const Icon = item.icon
                    const isActive = pathname === item.href
                    return (
                      <Link
                        key={item.name}
                        href={item.href}
                        onClick={() => setUserMenuOpen(false)}
                        className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                          isActive
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {item.name}
                      </Link>
                    )
                  })}
                  {/* Sign out */}
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      onClick={handleSignOut}
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 w-full transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-700 py-3">
            <div className="space-y-0.5">
              {allNav.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    {item.name}
                  </Link>
                )
              })}
              <div className="border-t border-slate-700 mt-2 pt-2">
                <div className="px-4 py-2">
                  <p className="text-sm font-medium text-white">{profile?.full_name || user.email}</p>
                  <p className="text-xs text-slate-400 capitalize">{userRole.replace('_', ' ')}</p>
                </div>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-red-400 hover:bg-slate-800 w-full transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
