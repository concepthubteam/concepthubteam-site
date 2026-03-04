/**
 * GOZI — TikTok Signal Inbox (Admin / Internal Screen)
 * Shows pending signals extracted from TikTok videos for review.
 *
 * Navigation:
 *   Stack.Screen name="TikTokInbox" component={TikTokInboxScreen}
 *   (accessible from ProfileScreen for admin users)
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { supabase } from '../lib/supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SIGNAL_LABELS = {
  venue_name:  { label: 'Venue',    icon: '📍', color: COLORS.accent },
  event_date:  { label: 'Dată',     icon: '📅', color: '#3B82F6' },
  ticket_url:  { label: 'Bilet',    icon: '🎟️', color: '#22C55E' },
  price:       { label: 'Preț',     icon: '💰', color: '#F59E0B' },
  promo_code:  { label: 'Promo',    icon: '🏷️', color: '#8B5CF6' },
};

const FILTER_TYPES = [
  { key: 'all',       label: 'Toate' },
  { key: 'venue_name',label: 'Venue' },
  { key: 'event_date',label: 'Dată' },
  { key: 'ticket_url',label: 'Bilet' },
  { key: 'price',     label: 'Preț' },
];

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchPendingSignals(filterType = 'all', limit = 50) {
  let query = supabase
    .from('v_signals_inbox')
    .select('*')
    .order('confidence', { ascending: false })
    .limit(limit);

  if (filterType !== 'all') {
    query = query.eq('type', filterType);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function reviewSignal(signalId, status, note = '') {
  const { error } = await supabase
    .from('signals')
    .update({
      review_status: status,
      reviewer_note: note || null,
    })
    .eq('id', signalId);
  if (error) throw error;
}

async function fetchStats() {
  const { data, error } = await supabase
    .from('signals')
    .select('review_status, type')
    .in('review_status', ['pending', 'approved', 'rejected']);

  if (error || !data) return { pending: 0, approved: 0, rejected: 0 };

  return data.reduce(
    (acc, row) => {
      acc[row.review_status] = (acc[row.review_status] || 0) + 1;
      return acc;
    },
    { pending: 0, approved: 0, rejected: 0 }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }) {
  const pct = Math.round((confidence || 0) * 100);
  const color = pct >= 80 ? COLORS.success : pct >= 60 ? COLORS.warning : COLORS.textSecondary;
  return (
    <View style={[styles.confidenceBadge, { borderColor: color + '55', backgroundColor: color + '18' }]}>
      <Text style={[styles.confidenceText, { color }]}>{pct}%</Text>
    </View>
  );
}

function TypeBadge({ type }) {
  const meta = SIGNAL_LABELS[type] || { label: type, icon: '⚡', color: COLORS.textSecondary };
  return (
    <View style={[styles.typeBadge, { backgroundColor: meta.color + '18', borderColor: meta.color + '44' }]}>
      <Text style={styles.typeBadgeIcon}>{meta.icon}</Text>
      <Text style={[styles.typeBadgeLabel, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

function SignalCard({ signal, onApprove, onReject }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(null); // 'approved' | 'rejected'

  const handleAction = async (action) => {
    setLoading(true);
    try {
      await reviewSignal(signal.id, action);
      setDone(action);
      if (action === 'approved') onApprove(signal.id);
      else onReject(signal.id);
    } catch (e) {
      console.warn('Signal review error:', e.message);
    }
    setLoading(false);
  };

  if (done) {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <Text style={styles.doneMark}>
          {done === 'approved' ? '✅ Aprobat' : '❌ Respins'}
        </Text>
        <Text style={styles.doneValue} numberOfLines={1}>{signal.value}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <TypeBadge type={signal.type} />
        <ConfidenceBadge confidence={signal.confidence} />
      </View>

      {/* Signal value */}
      <Text style={styles.signalValue}>{signal.value}</Text>

      {/* Context */}
      <View style={styles.contextRow}>
        <Ionicons name="logo-tiktok" size={12} color={COLORS.textMuted} />
        <Text style={styles.contextText} numberOfLines={1}>
          @{signal.account_username}
          {signal.account_name ? ` · ${signal.account_name}` : ''}
        </Text>
      </View>

      {signal.caption ? (
        <Text style={styles.captionText} numberOfLines={2}>
          "{signal.caption}"
        </Text>
      ) : null}

      {/* Match info */}
      {signal.matched_venue_name ? (
        <View style={styles.matchRow}>
          <Ionicons name="location" size={12} color={COLORS.accent} />
          <Text style={styles.matchText}>{signal.matched_venue_name}</Text>
        </View>
      ) : null}

      {signal.matched_event_title ? (
        <View style={styles.matchRow}>
          <Ionicons name="calendar" size={12} color="#3B82F6" />
          <Text style={styles.matchText}>{signal.matched_event_title}</Text>
        </View>
      ) : null}

      {/* Action buttons */}
      <View style={styles.actionRow}>
        {signal.type === 'ticket_url' && (
          <TouchableOpacity
            style={styles.btnOpen}
            onPress={() => Linking.openURL(signal.value)}
          >
            <Ionicons name="open-outline" size={14} color={COLORS.textSecondary} />
            <Text style={styles.btnOpenText}>Deschide</Text>
          </TouchableOpacity>
        )}

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.btn, styles.btnReject]}
            onPress={() => handleAction('rejected')}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={COLORS.offline} />
            ) : (
              <Ionicons name="close" size={18} color={COLORS.offline} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnApprove]}
            onPress={() => handleAction('approved')}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color={COLORS.success} />
            ) : (
              <Ionicons name="checkmark" size={18} color={COLORS.success} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function StatsBar({ stats }) {
  return (
    <View style={styles.statsBar}>
      <View style={styles.statItem}>
        <Text style={[styles.statNum, { color: COLORS.warning }]}>{stats.pending}</Text>
        <Text style={styles.statLabel}>Pending</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={[styles.statNum, { color: COLORS.success }]}>{stats.approved}</Text>
        <Text style={styles.statLabel}>Aprobate</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={[styles.statNum, { color: COLORS.offline }]}>{stats.rejected}</Text>
        <Text style={styles.statLabel}>Respinse</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function TikTokInboxScreen({ navigation }) {
  const [signals,     setSignals]     = useState([]);
  const [stats,       setStats]       = useState({ pending: 0, approved: 0, rejected: 0 });
  const [filterType,  setFilterType]  = useState('all');
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [data, statsData] = await Promise.all([
        fetchPendingSignals(filterType),
        fetchStats(),
      ]);
      setSignals(data);
      setStats(statsData);
    } catch (e) {
      setError(e.message || 'Eroare la încărcare');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterType]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = useCallback((id) => {
    setSignals(prev => prev.filter(s => s.id !== id));
    setStats(prev => ({
      ...prev,
      pending:  Math.max(0, prev.pending - 1),
      approved: prev.approved + 1,
    }));
  }, []);

  const handleReject = useCallback((id) => {
    setSignals(prev => prev.filter(s => s.id !== id));
    setStats(prev => ({
      ...prev,
      pending:  Math.max(0, prev.pending - 1),
      rejected: prev.rejected + 1,
    }));
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <Text style={styles.headerText}>TikTok Inbox</Text>
          {stats.pending > 0 && (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{stats.pending}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={() => load(true)} style={styles.refreshBtn}>
          <Ionicons name="refresh-outline" size={22} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <StatsBar stats={stats} />

      {/* Filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterContent}
      >
        {FILTER_TYPES.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterTab, filterType === f.key && styles.filterTabActive]}
            onPress={() => setFilterType(f.key)}
          >
            <Text style={[
              styles.filterTabText,
              filterType === f.key && styles.filterTabTextActive,
            ]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.accent} />
          <Text style={styles.loadingText}>Se încarcă semnale…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={36} color={COLORS.warning} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Reîncearcă</Text>
          </TouchableOpacity>
        </View>
      ) : signals.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>✅</Text>
          <Text style={styles.emptyTitle}>Inbox gol!</Text>
          <Text style={styles.emptyText}>
            {filterType === 'all'
              ? 'Nu sunt semnale pending.'
              : `Nu sunt semnale de tip "${SIGNAL_LABELS[filterType]?.label || filterType}".`}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={COLORS.accent}
            />
          }
        >
          <Text style={styles.listCount}>
            {signals.length} semnal{signals.length !== 1 ? 'e' : ''} pending
          </Text>
          {signals.map(signal => (
            <SignalCard
              key={signal.id}
              signal={signal}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn:     { padding: 4 },
  refreshBtn:  { padding: 4 },
  headerTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 12, gap: 8 },
  headerText:  { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  pendingBadge: {
    backgroundColor: COLORS.warning,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  pendingBadgeText: { fontSize: 11, fontWeight: '800', color: '#fff' },

  // Stats
  statsBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  statItem:   { flex: 1, alignItems: 'center' },
  statNum:    { fontSize: 20, fontWeight: '800' },
  statLabel:  { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  statDivider:{ width: 1, backgroundColor: COLORS.border, marginHorizontal: 8 },

  // Filters
  filterScroll:  { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterTabActive: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accentMid,
  },
  filterTabText:       { fontSize: 13, color: COLORS.textSecondary },
  filterTabTextActive: { color: COLORS.accent, fontWeight: '600' },

  // List
  list:        { flex: 1 },
  listContent: { padding: 16, gap: 12 },
  listCount:   { fontSize: 13, color: COLORS.textMuted, marginBottom: 4 },

  // Card
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  cardDone: {
    opacity: 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  doneMark:  { fontSize: 13, color: COLORS.textSecondary },
  doneValue: { flex: 1, fontSize: 13, color: COLORS.textMuted },

  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Type badge
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  typeBadgeIcon:  { fontSize: 12 },
  typeBadgeLabel: { fontSize: 11, fontWeight: '600' },

  // Confidence badge
  confidenceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  confidenceText: { fontSize: 11, fontWeight: '700' },

  signalValue: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },

  // Context
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  contextText: { fontSize: 12, color: COLORS.textMuted, flex: 1 },

  captionText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    lineHeight: 17,
  },

  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  matchText: { fontSize: 12, color: COLORS.textSecondary },

  // Actions
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  actionButtons: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  btnApprove: {
    backgroundColor: COLORS.successSoft,
    borderColor: COLORS.success + '44',
  },
  btnReject: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderColor: '#EF444444',
  },
  btnOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceAlt,
  },
  btnOpenText: { fontSize: 12, color: COLORS.textSecondary },

  // State views
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  loadingText: { fontSize: 14, color: COLORS.textMuted },
  errorText:   { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: COLORS.accentSoft,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.accentMid,
  },
  retryText:   { fontSize: 14, color: COLORS.accent, fontWeight: '600' },
  emptyIcon:   { fontSize: 48 },
  emptyTitle:  { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  emptyText:   { fontSize: 14, color: COLORS.textMuted, textAlign: 'center' },
});
