import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { Sale } from '../types';
import { computeSaleProfit, type SaleCostLine } from '../lib/financial';
import { 
  BarChart3, 
  TrendingUp, 
  Calendar, 
  Flame, 
  Layers, 
  Coins, 
  ShoppingCart,
  Activity
} from 'lucide-react';
import { Card } from './ui';
import { formatNumber, getDateLocale } from '../i18n/format';
import { useTranslation } from 'react-i18next';

interface SalesVolumeChartProps {
  sales: Sale[];
  saleCostSnapshots: Record<string, SaleCostLine[]>;
  currency?: string;
  showProfit?: boolean;
}

export default function SalesVolumeChart({ sales, saleCostSnapshots, currency = 'DT', showProfit = false }: SalesVolumeChartProps) {
  const { t, i18n } = useTranslation('reports');
  const isRtl = i18n.dir() === 'rtl';
  const [chartMode, setChartMode] = useState<'combined' | 'volume' | 'revenue'>('combined');

  // Safe date parser
  const getSaleDate = (sale: Sale): Date => {
    if (!sale.date) return new Date();
    if (typeof (sale.date as any).toDate === 'function') return (sale.date as any).toDate();
    if (sale.date instanceof Date) return sale.date;
    return new Date(sale.date);
  };

  // Compute 7 days rolling metrics
  const chartData = useMemo(() => {
    const days: {
      dateKey: string;
      dayLabel: string;
      fullDateLabel: string;
      volume: number;
      revenue: number;
      profit: number | null;
      profitIncomplete: boolean;
    }[] = [];

    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;

      const isToday = i === 0;
      const dayName = d.toLocaleDateString(getDateLocale(), { weekday: 'short' });
      const dayFormatted = d.toLocaleDateString(getDateLocale(), {
        weekday: 'short', 
        day: 'numeric', 
        month: 'short' 
      });

      days.push({
        dateKey,
        dayLabel: isToday ? t('salesVolume.today') : dayName.charAt(0).toUpperCase() + dayName.slice(1),
        fullDateLabel: isToday ? `${t('salesVolume.today')} (${d.toLocaleDateString(getDateLocale(), { day: 'numeric', month: 'short' })})` : dayFormatted,
        volume: 0,
        revenue: 0,
        profit: 0,
        profitIncomplete: false,
      });
    }

    // Populate with actual sales
    sales.forEach((sale) => {
      const sDate = getSaleDate(sale);
      const year = sDate.getFullYear();
      const month = String(sDate.getMonth() + 1).padStart(2, '0');
      const day = String(sDate.getDate()).padStart(2, '0');
      const saleDateKey = `${year}-${month}-${day}`;

      const matchedDay = days.find((d) => d.dateKey === saleDateKey);
      if (matchedDay) {
        matchedDay.volume += 1;
        matchedDay.revenue += Number(sale.total || 0);

        if (showProfit) {
          const margin = computeSaleProfit(sale, saleCostSnapshots[sale.id]);
          if (margin.profit === null) {
            matchedDay.profit = null;
            matchedDay.profitIncomplete = true;
          } else if (!matchedDay.profitIncomplete) {
            matchedDay.profit = (matchedDay.profit || 0) + margin.profit;
          }
        }
      }
    });

    const totalVolume = days.reduce((sum, d) => sum + d.volume, 0);
    const totalRevenue = days.reduce((sum, d) => sum + d.revenue, 0);
    const avgDailyVolume = (totalVolume / 7).toFixed(1);
    const avgDailyRevenue = (totalRevenue / 7).toFixed(2);
    
    // Day with highest volume
    const peakDay = days.reduce((max, d) => (d.volume > max.volume ? d : max), days[0]);

    return {
      days,
      totalVolume,
      totalRevenue,
      avgDailyVolume,
      avgDailyRevenue,
      peakDay
    };
  }, [sales, saleCostSnapshots, showProfit, t]);

  // Custom tooltips with styled Tailwind card
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      return (
        <div className="z-50 min-w-[200px] rounded-ds-lg border border-ds-border bg-ds-surface p-3.5 text-xs text-ds-text shadow-ds-md">
          <div className="mb-2 flex items-center gap-2 border-b border-ds-border pb-2">
            <Calendar className="h-3.5 w-3.5 text-ds-brand" />
            <span className="font-bold capitalize tracking-wide text-ds-text">
              {dataPoint.fullDateLabel}
            </span>
          </div>

          <div className="space-y-1.5 font-medium">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ds-muted">
                <span className="h-2 w-2 rounded-full bg-ds-brand"></span>
                {t('salesVolume.salesVolume')}:
              </span>
              <span className="font-mono text-sm font-black text-ds-text">
                {formatNumber(dataPoint.volume)} <span className="font-sans text-[10px] font-semibold text-ds-muted">{t('salesVolume.sales')}</span>
              </span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ds-muted">
                <span className="h-2 w-2 rounded-full bg-ds-accent"></span>
                {t('salesVolume.revenue')}:
              </span>
              <span className="font-mono text-sm font-black text-ds-text">
                {formatNumber(dataPoint.revenue, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} <span className="font-sans text-[10px] text-ds-muted">{currency}</span>
              </span>
            </div>

            {showProfit && dataPoint.profit !== null && dataPoint.profit !== 0 && (
              <div className="flex items-center justify-between gap-4 border-t border-ds-border pt-1 text-[11px]">
                <span className="text-ds-muted">{t('cards.grossProfit')}:</span>
                <span className={`font-mono font-bold ${dataPoint.profit < 0 ? 'text-ds-danger' : 'text-ds-success'}`}>
                  {dataPoint.profit > 0 ? '+' : ''}{formatNumber(dataPoint.profit, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} {currency}
                </span>
              </div>
            )}
            {showProfit && dataPoint.profitIncomplete && (
              <p className="pt-1 text-[10px] font-semibold text-ds-danger">{t('salesVolume.incompleteProfit')}</p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="min-w-0 rounded-ds-lg p-5 shadow-ds-sm transition-all sm:p-6">
      {/* Header with Title and Mode Switcher */}
      <div className="mb-5 flex flex-col justify-between gap-4 border-b border-ds-border pb-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-ds-brand-soft text-ds-brand">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold uppercase tracking-wider text-ds-text">
                {t('salesVolume.title')}
              </h2>
              <p className="mt-0.5 text-[11px] font-semibold uppercase text-ds-muted">
                {t('salesVolume.description')}
              </p>
            </div>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div role="group" aria-label={t('salesVolume.chartModeLabel')} className="flex max-w-full items-center gap-1 overflow-x-auto self-start rounded-full border border-ds-border bg-ds-surface-2 p-1 sm:self-auto">
          <button
            type="button"
            aria-pressed={chartMode === 'combined'}
            onClick={() => setChartMode('combined')}
            className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'combined'
                ? 'bg-ds-brand text-ds-brand-contrast font-extrabold'
                : 'text-ds-muted hover:text-ds-text'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{t('salesVolume.combined')}</span>
          </button>
          <button
            type="button"
            aria-pressed={chartMode === 'volume'}
            onClick={() => setChartMode('volume')}
            className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'volume'
                ? 'bg-ds-brand text-ds-brand-contrast font-extrabold'
                : 'text-ds-muted hover:text-ds-text'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>{t('salesVolume.volumeOnly')}</span>
          </button>
          <button
            type="button"
            aria-pressed={chartMode === 'revenue'}
            onClick={() => setChartMode('revenue')}
            className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              chartMode === 'revenue'
                ? 'bg-ds-brand text-ds-brand-contrast font-extrabold'
                : 'text-ds-muted hover:text-ds-text'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>{t('salesVolume.revenueOnly')}</span>
          </button>
        </div>
      </div>

      {/* KPI Highlights Bar */}
      <div className="mb-6 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-surface p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ds-brand-soft text-ds-brand">
            <ShoppingCart className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-ds-muted">
              {t('salesVolume.totalVolume')}
            </span>
            <span className="block font-display text-base font-bold tabular-nums text-ds-text">
              {formatNumber(chartData.totalVolume)} <span className="font-sans text-xs font-bold text-ds-muted">{t('salesVolume.sales')}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-surface p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ds-accent-soft text-ds-accent">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-ds-muted">
              {t('salesVolume.totalRevenue')}
            </span>
            <span className="block font-display text-base font-bold tabular-nums text-ds-text">
              {formatNumber(chartData.totalRevenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="font-sans text-xs font-bold text-ds-muted">{currency}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-surface p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ds-brand-soft text-ds-brand">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-ds-muted">
              {t('salesVolume.dailyAverage')}
            </span>
            <span className="block font-display text-base font-bold tabular-nums text-ds-text">
              {formatNumber(Number(chartData.avgDailyVolume), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span className="font-sans text-xs font-bold text-ds-muted">{t('salesVolume.salesPerDay')}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-ds-border bg-ds-surface p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ds-success-soft text-ds-success">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <span className="block text-[9px] font-black uppercase tracking-wider text-ds-muted">
              {t('salesVolume.peakActivity')}
            </span>
            <span className="block truncate text-sm font-bold text-ds-text">
              {t('salesVolume.peakDay', { day: chartData.peakDay.dayLabel, volume: formatNumber(chartData.peakDay.volume) })}
            </span>
          </div>
        </div>
      </div>

      {/* Recharts Chart Visualization */}
      <div className="w-full h-72 sm:h-80 select-none" role="img" aria-label={t('salesVolume.chartAccessibleLabel')}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData.days}
            margin={{ top: 10, right: isRtl ? -15 : 10, left: isRtl ? 10 : -15, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--ds-border)" />

            <XAxis 
              dataKey="dayLabel" 
              tickLine={false} 
              axisLine={{ stroke: 'var(--ds-border)' }}
              tick={{ fill: 'var(--ds-text-muted)', fontSize: 11, fontWeight: 600 }}
              dy={6}
            />

            {/* Left YAxis for Volume */}
            <YAxis 
              yAxisId="left" 
              orientation={isRtl ? 'right' : 'left'}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--ds-text-muted)', fontSize: 11, fontWeight: 600 }}
              tickFormatter={(value) => formatNumber(Number(value))}
              width={35}
            />

            {/* Right YAxis for Revenue when in combined mode */}
            {chartMode === 'combined' && (
              <YAxis 
                yAxisId="right" 
                orientation={isRtl ? 'left' : 'right'}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--ds-text-muted)', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => formatNumber(Number(val), { maximumFractionDigits: 2 })}
                width={45}
              />
            )}

            {chartMode === 'revenue' && (
              <YAxis 
                yAxisId="left" 
                orientation={isRtl ? 'right' : 'left'}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'var(--ds-text-muted)', fontSize: 10, fontWeight: 700 }}
                tickFormatter={(val) => formatNumber(Number(val), { maximumFractionDigits: 2 })}
                width={45}
              />
            )}

            <Tooltip content={<CustomTooltip />} />

            <Legend 
              verticalAlign="top"
              align={isRtl ? 'left' : 'right'}
              wrapperStyle={{ paddingBottom: '10px', fontSize: '11px', fontWeight: 600 }}
              formatter={(value) => {
                if (value === 'volume') return <span className="font-bold text-ds-brand">{t('salesVolume.salesCount')}</span>;
                if (value === 'revenue') return <span className="font-bold text-ds-accent">{t('salesVolume.revenueWithCurrency', { currency })}</span>;
                return value;
              }}
            />

            {/* Volume Bars */}
            {(chartMode === 'combined' || chartMode === 'volume') && (
              <Bar
                yAxisId="left"
                dataKey="volume"
                name="volume"
                fill="var(--ds-brand)"
                radius={[8, 8, 0, 0]}
                barSize={32}
                animationDuration={800}
              />
            )}

            {/* Revenue Area */}
            {(chartMode === 'combined' || chartMode === 'revenue') && (
              <Area
                yAxisId={chartMode === 'combined' ? 'right' : 'left'}
                type="monotone"
                dataKey="revenue"
                name="revenue"
                stroke="var(--ds-accent)"
                strokeWidth={3}
                fill="var(--ds-accent-soft)"
                dot={{ r: 4, fill: 'var(--ds-accent)', strokeWidth: 2, stroke: 'var(--ds-brand-contrast)' }}
                activeDot={{ r: 6, fill: 'var(--ds-accent)', stroke: 'var(--ds-brand-contrast)', strokeWidth: 2 }}
                animationDuration={1000}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ds-border pt-3 text-[11px] font-semibold text-ds-muted">
        <span className="flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-ds-accent" />
          {t('salesVolume.chartHelp')}
        </span>
        <span className="font-bold text-ds-muted">
          {t('salesVolume.lastUpdated')}
        </span>
      </div>
    </Card>
  );
}
