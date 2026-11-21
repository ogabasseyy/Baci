import { brilStashOperatorCommands } from '../../schemas/brilstash-operator';
import { brilStashOperatorEnvelope } from '../../schemas/brilstash-operator-envelope';

type OperatorClient = {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export function resolveBrilStashOperatorCommand(
  input: unknown,
  apply: boolean
) {
  const envelope = brilStashOperatorEnvelope.safeParse(input);
  if (!envelope.success) throw new Error('Invalid BrilStash operator input');
  const action = brilStashOperatorCommands[envelope.data.action];
  const args = action.args.safeParse(envelope.data.args);
  if (!args.success) throw new Error('Invalid BrilStash operator input');
  if (action.writes && !apply)
    throw new Error('BrilStash write requires --apply');
  return { rpc: action.rpc, args: args.data };
}

export async function runBrilStashOperatorCommand(
  client: OperatorClient,
  input: unknown,
  apply: boolean
) {
  const command = resolveBrilStashOperatorCommand(input, apply);
  try {
    const { data, error } = await client.rpc(command.rpc, command.args);
    if (!error) return data;
  } catch {
    // Do not include provider errors or request data in CLI output.
  }
  throw new Error('BrilStash operator command failed');
}
