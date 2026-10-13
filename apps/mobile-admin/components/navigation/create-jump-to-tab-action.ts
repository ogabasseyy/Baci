type JumpToTabAction = {
  payload: { name: string; params: unknown };
  type: 'JUMP_TO';
};

export function createJumpToTabAction(
  name: string,
  params: unknown
): JumpToTabAction {
  return {
    payload: { name, params },
    type: 'JUMP_TO',
  };
}
