import { type NextRequest, NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { notifyLowStock } from '@/lib/expo-push';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/inventory/push-alerts
 *
 * Sends push notifications for new low stock alerts that haven't been notified yet.
 * Called by the VPS web-cron wrapper every 6 hours. Keep CRON_SECRET gating intact.
 */
// react-doctor-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- VPS cron invokes this GET with a bearer CRON_SECRET; browser CSRF cannot supply the required Authorization header.
export async function GET(request: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('Authorization');
  const expectedToken = `Bearer ${cronSecret}`;
  if (!authHeader || !constantTimeEqual(authHeader, expectedToken)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createAdminClient();

    // Get all active, unnotified inventory alerts
    const { data: alerts, error } = await supabase
      .from('inventory_alerts')
      .select(`
        id,
        merchant_id,
        alert_type,
        current_stock,
        threshold,
        days_until_stockout,
        products (
          id,
          name
        )
      `)
      .eq('status', 'active')
      .eq('notification_sent', false)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[Inventory Alerts] Error fetching alerts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch alerts' },
        { status: 500 }
      );
    }

    if (!alerts || alerts.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No new alerts to notify',
        sent: 0,
      });
    }

    let sentCount = 0;
    let failedCount = 0;

    // Process each alert and send push notification
    for (const alert of alerts) {
      try {
        // Products join can return array or single object depending on relationship
        const products = alert.products as unknown as
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
        const product = Array.isArray(products) ? products[0] : products;
        const productName = product?.name || 'Unknown Product';
        const threshold = alert.threshold || 5;

        // Send push notification to merchant
        await notifyLowStock(
          alert.merchant_id,
          product?.id ?? null,
          productName,
          alert.current_stock,
          threshold
        );

        // Mark alert as notified
        await supabase
          .from('inventory_alerts')
          .update({
            notification_sent: true,
            notification_sent_at: new Date().toISOString(),
          })
          .eq('id', alert.id);

        sentCount++;
      } catch (pushError) {
        console.error('[Inventory Alerts] Failed to notify for alert:', {
          alertId: alert.id,
          error: pushError,
        });
        failedCount++;
      }
    }

    console.log(
      `[Inventory Alerts] Sent ${sentCount} push notifications, ${failedCount} failed`
    );

    return NextResponse.json({
      success: true,
      sent: sentCount,
      failed: failedCount,
      total: alerts.length,
    });
  } catch (error) {
    console.error('[Inventory Alerts] Push notification error:', error);
    return NextResponse.json(
      { error: 'Push notification failed' },
      { status: 500 }
    );
  }
}
