'use client';

import {
  VictoryAxis,
  VictoryChart,
  VictoryLine,
  VictoryScatter,
  VictoryTooltip,
  VictoryVoronoiContainer
} from 'victory';

export type LineChartSeries = {
  name: string;
  color: string;
  data: Array<{ x: number; y: number; tooltip: string }>;
};

export function InteractiveLineChart({
  compact = false,
  height,
  series,
  xAxisLabel,
  xDomain,
  xTickFormat,
  xTickValues,
  yAxisLabel
}: {
  compact?: boolean;
  height: number;
  series: LineChartSeries[];
  xAxisLabel?: string;
  xDomain?: [number, number];
  xTickFormat?: (value: number) => string;
  xTickValues?: number[];
  yAxisLabel?: string;
}) {
  const values = series.flatMap((item) => item.data.map((point) => point.y));
  const maximum = Math.max(compact ? 1 : 20, Math.ceil(Math.max(...values, 0) / 10) * 10);
  const yStep = maximum <= 20 ? 5 : 10;
  const yTickValues = Array.from({ length: Math.floor(maximum / yStep) + 1 }, (_, index) => index * yStep);
  const width = compact ? 92 : 620;

  return (
    <VictoryChart
      containerComponent={
        <VictoryVoronoiContainer
          labels={({ datum }) => datum.tooltip}
          labelComponent={
            <VictoryTooltip
              cornerRadius={7}
              flyoutPadding={{ top: 6, bottom: 6, left: 8, right: 8 }}
              flyoutStyle={{ fill: 'var(--panelBackground)', stroke: 'var(--glass-border-strong)' }}
              pointerLength={5}
              style={{ fill: 'var(--textColor)', fontFamily: 'inherit', fontSize: compact ? 7 : 10 }}
            />
          }
          voronoiDimension="x"
        />
      }
      domain={xDomain ? { x: xDomain, y: [0, maximum] } : { y: [0, maximum] }}
      height={height}
      padding={compact ? 1 : { top: 10, right: 14, bottom: 46, left: 62 }}
      width={width}
    >
      {!compact && (
        <VictoryAxis
          label={xAxisLabel}
          tickFormat={xTickFormat}
          tickValues={xTickValues}
          style={{
            axis: { stroke: 'var(--borderColor)' },
            axisLabel: {
              fill: 'var(--mutedTextColor)',
              fontFamily: 'inherit',
              fontSize: 10,
              fontWeight: 650,
              padding: 31
            },
            grid: { stroke: 'var(--glass-border-strong)', strokeDasharray: '3 5', strokeWidth: 0.7 },
            tickLabels: { fill: 'var(--mutedTextColor)', fontFamily: 'inherit', fontSize: 10, padding: 7 },
            ticks: { stroke: 'var(--glass-border-strong)', size: 4 }
          }}
        />
      )}
      {!compact && (
        <VictoryAxis
          dependentAxis
          label={yAxisLabel}
          orientation="left"
          tickFormat={(value) => `${value}%`}
          tickValues={yTickValues}
          style={{
            axis: { stroke: 'var(--borderColor)' },
            axisLabel: {
              fill: 'var(--mutedTextColor)',
              fontFamily: 'inherit',
              fontSize: 10,
              fontWeight: 650,
              padding: 45
            },
            grid: { stroke: 'var(--glass-border-strong)', strokeDasharray: '3 5', strokeWidth: 0.7 },
            tickLabels: { fill: 'var(--mutedTextColor)', fontFamily: 'inherit', fontSize: 10, padding: 7 },
            ticks: { stroke: 'var(--glass-border-strong)', size: 4 }
          }}
        />
      )}
      {series.map((item) => (
        <VictoryLine
          data={item.data}
          interpolation="monotoneX"
          key={`${item.name}-line`}
          style={{ data: { stroke: item.color, strokeLinecap: 'round', strokeWidth: compact ? 1.7 : 2.2 } }}
        />
      ))}
      {series.map((item) => (
        <VictoryScatter
          data={item.data}
          key={`${item.name}-points`}
          size={compact ? 2 : 2.7}
          style={{ data: { fill: item.color, stroke: 'var(--panelBackground)', strokeWidth: 0.8 } }}
        />
      ))}
    </VictoryChart>
  );
}
