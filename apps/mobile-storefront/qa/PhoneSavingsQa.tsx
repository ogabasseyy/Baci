import type { SavingsScreenSource } from '@baci/shared/contracts';
import { fetch as nativeFetch } from 'expo/fetch';
import { hideAsync } from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Button, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { createRuntimeJourneyBrowserClient } from '../../../tools/test/runtime-journey-browser/client';
import { PiggyvestSavingsScreen } from '../components/wallet/savings/PiggyvestSavingsScreen';
import Colors from '../constants/Colors';
import { createPhoneQaFetch } from './phone-qa-fetch';

type Client = ReturnType<typeof createRuntimeJourneyBrowserClient>;
type Binding = Awaited<ReturnType<Client['cancellation']>>;

function Journey({ sequence }: { sequence: 701 | 702 }) {
  const live = useRef(true);
  const [source, setSource] = useState<SavingsScreenSource>({
    environment: 'staging',
    status: 'loading',
  });
  const [client, setClient] = useState<Client | null>(null);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    live.current = true;
    let owned: Binding | undefined;
    void (async () => {
      const transport = createPhoneQaFetch(
        process.env.EXPO_PUBLIC_PHONE_QA_ORIGIN ?? '',
        process.env.EXPO_PUBLIC_PHONE_QA_TOKEN ?? '',
        nativeFetch
      );
      const response = await transport('http://127.0.0.1:4183/qa-config.json');
      if (!response.ok) throw new Error('Unavailable');
      const configuration = await response.json();
      const scenario = configuration.scenarios?.find(
        (item: { pathPrefix: string }) =>
          item.pathPrefix === `/scenario/${sequence}`
      );
      const connection = createRuntimeJourneyBrowserClient({
        origin: 'http://127.0.0.1:4183',
        scenario,
        fetch: transport,
        isCurrent: () => live.current,
      });
      const next = await connection.screen();
      if (!live.current) return;
      setClient(connection);
      setSource(next);
      if (next.status === 'ready' && scenario.operationId) {
        owned = await connection.cancellation(
          next,
          await connection.cancellationMode()
        );
        if (live.current) setBinding(owned);
        else owned.invalidate();
      }
    })().catch(() => {
      if (live.current) {
        setError(true);
        setSource({ environment: 'staging', status: 'unavailable' });
      }
    });
    return () => {
      live.current = false;
      owned?.invalidate();
    };
  }, [sequence]);
  if (error)
    return (
      <Text>
        Local backend unavailable. No production fallback. Ask Codex to check
        the test server.
      </Text>
    );
  return (
    <PiggyvestSavingsScreen
      staging={{
        environment: 'staging',
        source,
        sessionKey: source.status === 'ready' ? source.sessionKey : null,
        goalId: source.status === 'ready' ? source.goalId : null,
        cancellation: binding,
        onAccept: async (acceptance) => {
          if (!client || !live.current)
            throw new Error('Local test unavailable');
          await client.submit(acceptance);
          const next = await client.screen();
          if (live.current) setSource(next);
        },
      }}
    />
  );
}

export function PhoneSavingsQa() {
  const [sequence, setSequence] = useState<701 | 702>(701);
  const [visible, setVisible] = useState(true);
  const [splashError, setSplashError] = useState(false);
  const laidOut = useRef(false);
  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: Colors.light.background }}
        onLayout={() => {
          if (laidOut.current) return;
          laidOut.current = true;
          void hideAsync()
            .then(() =>
              console.info(
                '[PhoneQA] Test screen layout ready; splash dismissed'
              )
            )
            .catch(() => setSplashError(true));
        }}
      >
        <Text accessibilityRole="header" style={{ color: Colors.light.text }}>
          ISOLATED PHONE TEST — synthetic data only
        </Text>
        <Text style={{ color: Colors.light.text }}>
          No production login, catalogue or payments. Test authentication is
          supplied by the local relay, not a real customer session.
        </Text>
        {splashError && (
          <Text style={{ color: Colors.light.text }}>
            Test splash dismissal failed. Reload the development build.
          </Text>
        )}
        <Button title="256GB draft" onPress={() => setSequence(701)} />
        <Button
          title="512GB cancellation test"
          onPress={() => setSequence(702)}
        />
        <Button
          title={visible ? 'Hide test session' : 'Reconnect test session'}
          onPress={() => setVisible(!visible)}
        />
        {visible && <Journey key={sequence} sequence={sequence} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
