import { AlertTriangle, Package, TrendingUp } from 'lucide-react';
import { BentoCard } from '@/components/ui/bento-card';
import { cn } from '@/lib/utils';
import type { AnalyticsData, WidgetVisibility } from './analytics-grid-types';

interface AnalyticsInventoryWidgetsProps {
  data: AnalyticsData;
  isWidgetVisible: WidgetVisibility;
}

type InventoryForecastRow = NonNullable<
  AnalyticsData['inventoryForecasts']
>[number];

function isOutOfStockForecast(forecast: InventoryForecastRow): boolean {
  return forecast.status === 'out_of_stock' || forecast.current_stock <= 0;
}

export function AnalyticsInventoryWidgets({
  data,
  isWidgetVisible,
}: AnalyticsInventoryWidgetsProps) {
  const lowStockProducts = (data.inventoryForecasts || [])
    .filter((forecast) => {
      const isClassifiedLowStock =
        forecast.status === 'critical' ||
        forecast.status === 'warning' ||
        forecast.status === 'out_of_stock';
      const lowStockThreshold = forecast.low_stock_threshold ?? 5;

      return (
        forecast.current_stock <= 0 ||
        isClassifiedLowStock ||
        forecast.current_stock <= lowStockThreshold ||
        forecast.days_of_stock <= 14
      );
    })
    .slice(0, 5);
  return (
    <>
      {isWidgetVisible('inventory-summary') && (
        <div key="inventory-summary">
          <BentoCard title="Inventory Health" icon={Package} className="h-full">
            <div className="flex items-center justify-between">
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500">
                  {data.outOfStockCount || 0}
                </div>
                <div className="text-xs text-muted-foreground">
                  Out of Stock
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-amber-500">
                  {data.lowStockCount || 0}
                </div>
                <div className="text-xs text-muted-foreground">Low Stock</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  {data.resolvedInventoryAlertCount || 0}
                </div>
                <div className="text-xs text-muted-foreground">Resolved</div>
              </div>
            </div>
          </BentoCard>
        </div>
      )}

      {isWidgetVisible('inventory-alerts') && (
        <div key="inventory-alerts">
          <BentoCard
            title="Stock Alerts"
            icon={AlertTriangle}
            className="h-full"
          >
            <div className="custom-scrollbar max-h-[200px] space-y-3 overflow-y-auto pr-2">
              {(data.inventoryAlerts || []).length === 0 ? (
                <div className="py-4 text-center text-muted-foreground">
                  <Package className="mx-auto mb-2 size-8 opacity-50" />
                  <p className="text-sm">No active alerts</p>
                </div>
              ) : (
                data.inventoryAlerts?.slice(0, 5).map((alert) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between rounded-lg bg-muted/30 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'size-2 rounded-full',
                          alert.alert_type === 'out_of_stock'
                            ? 'bg-red-500'
                            : alert.alert_type === 'low_stock'
                              ? 'bg-amber-500'
                              : 'bg-blue-500'
                        )}
                      />
                      <div>
                        <p className="text-sm font-medium">
                          {alert.product_name || 'Unknown Product'}
                        </p>
                        <p className="text-xs capitalize text-muted-foreground">
                          {alert.alert_type.replace('_', ' ')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">{alert.current_stock}</p>
                      <p className="text-xs text-muted-foreground">in stock</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </BentoCard>
        </div>
      )}

      {isWidgetVisible('inventory-forecast') && (
        <div key="inventory-forecast">
          <BentoCard
            title="Stock Forecast"
            icon={TrendingUp}
            className="h-full"
          >
            <div className="custom-scrollbar max-h-[300px] space-y-3 overflow-y-auto pr-2">
              {(data.inventoryForecasts || []).length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <TrendingUp className="mx-auto mb-2 size-8 opacity-50" />
                  <p className="text-sm">No forecast data available</p>
                  <p className="text-xs">
                    Add products with stock tracking enabled
                  </p>
                </div>
              ) : (
                data.inventoryForecasts?.slice(0, 8).map((forecast) => (
                  <div
                    key={forecast.product_id}
                    className="flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {forecast.product_name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{forecast.current_stock} units</span>
                        <span>•</span>
                        <span>{forecast.avg_daily_sales}/day</span>
                      </div>
                    </div>
                    <div className="ml-2 text-right">
                      <p
                        className={cn(
                          'text-sm font-bold',
                          isOutOfStockForecast(forecast) ||
                            forecast.days_of_stock <= 7
                            ? 'text-red-500'
                            : forecast.days_of_stock <= 14
                              ? 'text-amber-500'
                              : 'text-green-500'
                        )}
                      >
                        {isOutOfStockForecast(forecast)
                          ? 'Out of stock'
                          : `${Math.round(forecast.days_of_stock)} days`}
                      </p>
                      <div className="text-xs text-muted-foreground">
                        {forecast.sales_trend === 'increasing' && '↑'}
                        {forecast.sales_trend === 'decreasing' && '↓'}
                        {forecast.sales_trend === 'stable' && '→'}{' '}
                        {forecast.sales_trend}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </BentoCard>
        </div>
      )}

      {isWidgetVisible('low-stock-products') && (
        <div key="low-stock-products">
          <BentoCard
            title="Low Stock Products"
            icon={Package}
            className="h-full"
          >
            <div className="custom-scrollbar max-h-[200px] space-y-2 overflow-y-auto pr-2">
              {lowStockProducts.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground">
                  <p className="text-sm">All products well stocked</p>
                </div>
              ) : (
                lowStockProducts.map((product) => (
                  <div
                    key={product.product_id}
                    className="flex items-center justify-between rounded-lg bg-amber-500/10 p-2"
                  >
                    <span className="flex-1 truncate text-sm">
                      {product.product_name}
                    </span>
                    <span className="ml-2 text-sm font-bold text-amber-600">
                      {product.current_stock} left
                    </span>
                  </div>
                ))
              )}
            </div>
          </BentoCard>
        </div>
      )}
    </>
  );
}
