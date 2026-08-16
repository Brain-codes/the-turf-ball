import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSupabase, hasStoredSession } from '@/lib/supabase'
import { api, setActiveOrg, getActiveOrg } from '@/services/client'
import type { Organization, Profile } from '@/types'

interface MeResponse {
  profile: Profile
  organizations: Organization[]
  needs_onboarding: boolean
}

interface AuthState {
  loading: boolean
  authenticated: boolean
  profile: Profile | null
  organizations: Organization[]
  activeOrg: Organization | null
  needsOnboarding: boolean
  refresh: () => Promise<void>
  switchOrg: (id: string) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [activeOrgId, setActiveOrgId] = useState<string | null>(getActiveOrg())

  const load = useCallback(async () => {
    // Skip loading the auth library entirely for a visitor who has never
    // signed in — the share page should cost them nothing.
    if (!hasStoredSession()) {
      setAuthenticated(false)
      setProfile(null)
      setOrganizations([])
      setLoading(false)
      return
    }

    const supabase = await getSupabase()
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      setAuthenticated(false)
      setProfile(null)
      setOrganizations([])
      setLoading(false)
      return
    }

    setAuthenticated(true)
    try {
      const { data: me } = await api.get<MeResponse>('auth/me')
      setProfile(me.profile)
      setOrganizations(me.organizations)

      // Keep the stored active group honest: if it was deleted or access was
      // revoked, fall back to the first one they still belong to.
      const stored = getActiveOrg()
      const valid = me.organizations.find((o) => o.id === stored)
      const next = valid?.id ?? me.organizations[0]?.id ?? null
      setActiveOrg(next)
      setActiveOrgId(next)
    } catch {
      setProfile(null)
      setOrganizations([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()

    let unsubscribe: (() => void) | undefined
    if (hasStoredSession()) {
      getSupabase().then((supabase) => {
        const { data: sub } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
            load()
          }
        })
        unsubscribe = () => sub.subscription.unsubscribe()
      })
    }
    return () => unsubscribe?.()
  }, [load])

  const switchOrg = useCallback((id: string) => {
    setActiveOrg(id)
    setActiveOrgId(id)
  }, [])

  const signOut = useCallback(async () => {
    const supabase = await getSupabase()
    await supabase.auth.signOut()
    setActiveOrg(null)
    setAuthenticated(false)
    setProfile(null)
    setOrganizations([])
  }, [])

  const value = useMemo<AuthState>(() => {
    const activeOrg = organizations.find((o) => o.id === activeOrgId) ?? organizations[0] ?? null
    return {
      loading,
      authenticated,
      profile,
      organizations,
      activeOrg,
      needsOnboarding: authenticated && organizations.length === 0,
      refresh: load,
      switchOrg,
      signOut,
    }
  }, [loading, authenticated, profile, organizations, activeOrgId, load, switchOrg, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
