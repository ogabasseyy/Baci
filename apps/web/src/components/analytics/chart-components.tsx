'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ChartProps {
  data: object[];
  className?: string;
  valueFormatter?: (value: number) => string;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  prefix?: string;
  valueFormatter?: (value: number) => string;
}

const CustomTooltip = ({
  active,
  payload,
  label,
  prefix = '',
  valueFormatter,
}: TooltipProps) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-xl border bg-background/95 backdrop-blur-xs p-3 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <p className="text-lg font-bold text-foreground">
          {valueFormatter
            ? valueFormatter(payload[0].value)
            : `${prefix}${payload[0].value.toLocaleString()}`}
        </p>
      </div>
    );
  }
  return null;
};

export function RevenueChart({ data, className, valueFormatter }: ChartProps) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      className={className}
      debounce={100}
    >
      <AreaChart
        data={data}
        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="currentColor"
          className="text-muted/20"
        />
        <XAxis
          dataKey="day"
          stroke="currentColor"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          className="text-muted-foreground"
          dy={10}
        />
        <YAxis
          stroke="currentColor"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) =>
            valueFormatter ? valueFormatter(Number(value)) : `$${value}`
          }
          className="text-muted-foreground"
        />
        <Tooltip
          content={<CustomTooltip prefix="$" valueFormatter={valueFormatter} />}
          cursor={{ stroke: '#6366f1', strokeWidth: 2 }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#6366f1"
          strokeWidth={3}
          fillOpacity={1}
          fill="url(#colorRevenue)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function OrdersChart({ data, className }: ChartProps) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      className={className}
      debounce={100}
    >
      <BarChart
        data={data}
        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="currentColor"
          className="text-muted/20"
        />
        <XAxis
          dataKey="day"
          stroke="currentColor"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          className="text-muted-foreground"
          dy={10}
        />
        <YAxis
          stroke="currentColor"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          className="text-muted-foreground"
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ fill: 'currentColor', opacity: 0.1 }}
        />
        <Bar
          dataKey="orders"
          fill="#10b981"
          radius={[4, 4, 0, 0]}
          maxBarSize={50}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];

export function SalesByChannelChart({
  data,
  className,
  valueFormatter,
}: ChartProps) {
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      minWidth={0}
      minHeight={0}
      className={className}
      debounce={100}
    >
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={80}
          paddingAngle={5}
          dataKey="value"
          nameKey="name"
          stroke="none"
        >
          {data.map((_entry, index) => (
            <Cell
              // biome-ignore lint/suspicious/noArrayIndexKey: Chart cells use color array with stable positions
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) =>
            valueFormatter
              ? valueFormatter(Number(value))
              : `$${Number(value).toLocaleString()}`
          }
          contentStyle={{
            borderRadius: '12px',
            border: 'none',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          iconType="circle"
          formatter={(value) => (
            <span className="text-sm font-medium text-muted-foreground ml-1">
              {value}
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
