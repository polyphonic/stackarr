'use client';

import { VictoryChart, VictoryLine, VictoryScatter, VictoryTooltip, VictoryVoronoiContainer } from 'victory';

export type LineChartSeries = {
  name: string;
  color: string;
  data: Array<{ x: number; y: number; tooltip: string }>;
};

export function InteractiveLineChart({
  compact = false,
  height,
  series
}: {
  compact?: boolean;
  height: number;
  series: LineChartSeries[];
}) {
  const values = series.flatMap((item) => item.data.map((point) => point.y));
  const maximum = Math.max(compact ? 1 : 20, Math.ceil(Math.max(...values, 0) / 10) * 10);
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
      domain={{ y: [0, maximum] }}
      height={height}
      padding={compact ? 1 : { top: 10, right: 4, bottom: 20, left: 4 }}
      width={width}
    >
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
