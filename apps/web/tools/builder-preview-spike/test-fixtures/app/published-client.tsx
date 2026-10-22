'use client';
import { useEffect, useState } from 'react';
import { PublicPortableHome } from '@/components/storefront/portable/public-portable-home';
import { verifyPortablePublishedSnapshot } from '@/lib/portable-published-snapshot';
import type { PortablePublishedSnapshot } from '@/schemas/portable-published-snapshot';
import { merchant } from '../../fixtures';

export function PublishedClient() {
  const [snapshot, setSnapshot] = useState<PortablePublishedSnapshot | null>(
    null
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const revision =
      new URLSearchParams(window.location.search).get('revision') === '2'
        ? '2'
        : '1';
    fetch(`/api/published-home?revision=${revision}`)
      .then((response) => {
        if (!response.ok) throw new Error('Fixture read failed');
        return response.json();
      })
      .then(verifyPortablePublishedSnapshot)
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  if (failed) return <p role="alert">Snapshot validation failed</p>;
  if (!snapshot) return <p role="status">Loading published config</p>;
  return (
    <PublicPortableHome
      config={snapshot.config}
      merchant={merchant}
      basePath=""
    />
  );
}
