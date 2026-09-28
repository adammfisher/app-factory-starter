import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { env } from '../src/env';
import { labBlocks, type LabBlock, type LabCheck } from '../src/lab/blocks';
import { strings } from '../src/strings';
import { theme } from '../src/theme';

// A check still running this long after it started fails, and the next one starts.
const TIMEOUT_MS = 60_000;
const MAX_WIDTH = 720;

type Outcome = { status: 'running' } | { status: 'pass' } | { status: 'fail'; error: string };
type Colors = (typeof theme)['light'] | (typeof theme)['dark'];

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

// Runs one check under its own timer. A check that settles after its timeout changes nothing.
function runCheck(check: LabCheck): Promise<Outcome> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: 'fail', error: strings.lab.timedOut }), TIMEOUT_MS);
    let running: Promise<unknown>;
    try {
      running = Promise.resolve(check.run());
    } catch (error) {
      running = Promise.reject(error);
    }
    running.then(
      () => {
        clearTimeout(timer);
        resolve({ status: 'pass' });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve({ status: 'fail', error: errorText(error) });
      },
    );
  });
}

function BlockLab({ colors }: { colors: Colors }) {
  const blocks = [...labBlocks].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const [outcomes, setOutcomes] = useState<Record<string, Outcome[]>>({});
  const [totals, setTotals] = useState<{ passed: number; failed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const setOutcome = (block: string, index: number, outcome: Outcome) =>
    setOutcomes((current) => {
      const list = [...(current[block] ?? [])];
      list[index] = outcome;
      return { ...current, [block]: list };
    });

  // Runs a block's checks one at a time, in order, and returns their outcomes.
  const runBlock = async (block: LabBlock): Promise<Outcome[]> => {
    setOutcomes((current) => ({ ...current, [block.name]: [] }));
    const results: Outcome[] = [];
    for (const [index, check] of block.deviceChecks.entries()) {
      if (!mounted.current) break;
      setOutcome(block.name, index, { status: 'running' });
      const outcome = await runCheck(check);
      results.push(outcome);
      setOutcome(block.name, index, outcome);
    }
    return results;
  };

  const runOne = async (block: LabBlock) => {
    setBusy(true);
    await runBlock(block);
    setBusy(false);
  };

  const runAll = async () => {
    setBusy(true);
    setTotals(null);
    const results: Outcome[] = [];
    for (const block of blocks) results.push(...(await runBlock(block)));
    setTotals({
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
    });
    setBusy(false);
  };

  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <RunButton label={strings.lab.runAll} accessibilityLabel={strings.lab.runAllLabel} disabled={busy} onPress={runAll} colors={colors} />
        <View testID="lab-totals" style={{ flexDirection: 'row', gap: 12 }}>
          {totals ? (
            <>
              <Text style={{ fontSize: 15, color: colors.pass }}>{strings.lab.passed(totals.passed)}</Text>
              <Text style={{ fontSize: 15, color: colors.fail }}>{strings.lab.failed(totals.failed)}</Text>
            </>
          ) : null}
        </View>
      </View>
      {blocks.map((block) => (
        <View
          key={block.name}
          testID={`block-row-${block.name}`}
          style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.border }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>
              {block.name}
            </Text>
            {block.deviceChecks.length > 0 ? (
              <RunButton
                label={strings.lab.run}
                accessibilityLabel={strings.lab.runLabel(block.name)}
                disabled={busy}
                onPress={() => runOne(block)}
                colors={colors}
              />
            ) : null}
          </View>
          {block.deviceChecks.length === 0 ? (
            <Text style={{ fontSize: 15, color: colors.muted }}>{strings.lab.noDeviceChecks}</Text>
          ) : (
            block.deviceChecks.map((check, index) => (
              <CheckRow key={index} testID={`check-${block.name}-${index}`} name={check.name} outcome={outcomes[block.name]?.[index]} colors={colors} />
            ))
          )}
        </View>
      ))}
    </>
  );
}

function CheckRow({ testID, name, outcome, colors }: { testID: string; name: string; outcome?: Outcome; colors: Colors }) {
  const status =
    outcome?.status === 'pass'
      ? { text: strings.lab.pass, color: colors.pass }
      : outcome?.status === 'fail'
        ? { text: strings.lab.fail, color: colors.fail }
        : outcome?.status === 'running'
          ? { text: strings.lab.running, color: colors.muted }
          : null;
  return (
    <View testID={testID} style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ fontSize: 15, color: colors.text, flexShrink: 1 }}>{name}</Text>
        {status ? <Text style={{ fontSize: 15, fontWeight: '600', color: status.color }}>{status.text}</Text> : null}
      </View>
      {outcome?.status === 'fail' ? <Text style={{ fontSize: 13, color: colors.fail }}>{outcome.error}</Text> : null}
    </View>
  );
}

function RunButton(props: { label: string; accessibilityLabel: string; disabled: boolean; onPress: () => void; colors: Colors }) {
  const { label, accessibilityLabel, disabled, onPress, colors } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 16,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 8,
        backgroundColor: colors.button,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: '600', color: colors.buttonText }}>{label}</Text>
    </Pressable>
  );
}

export default function BlockLabScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColorScheme() === 'dark' ? theme.dark : theme.light;
  const enabled = env.blockLab === '1';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        paddingTop: insets.top + 16,
        paddingBottom: insets.bottom + 16,
        paddingLeft: insets.left + 24,
        paddingRight: insets.right + 24,
      }}
    >
      <View style={{ width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: 16 }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', color: colors.text }}>
          {strings.lab.title}
        </Text>
        {enabled ? <BlockLab colors={colors} /> : <Text style={{ fontSize: 15, color: colors.text }}>{strings.lab.notAvailable}</Text>}
      </View>
    </ScrollView>
  );
}
