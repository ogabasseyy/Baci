// Lab comparison arm identity for the merchant image pilot. Both arms
// render through the same lab mounts: the pilot arm is fed pilot
// projections over staged derivatives, the control arm is fed control
// projections over staged originals. Pure type module (no server-only):
// client clones import the type, which erases at compile time.
export type PilotLabArm = 'control' | 'pilot';
