// Flattens effect steps (with if/may/choice and segments) into a linear program with jumps.
// A running effect is then just a program counter plus variables: plain data in the game state.

import type { Cond, Effect, Prim, Step } from "./dsl";

export type Instr =
  | (Prim & { fail: number })
  | { op: "jumpUnless"; cond: Cond; to: number }
  | { op: "jump"; to: number }
  /** Yes/no question to the controller; "no" jumps to `to`. */
  | { op: "ask"; to: number }
  /** The controller picks one alternative and continues at its start. */
  | { op: "pick"; options: { label: string; to: number }[] };

export type Program = Instr[];

export function compileSegments(segments: Step[][]): Program {
  const code: Program = [];
  const fixups: { index: number; label: number }[] = [];
  let nextLabel = 0;
  const labels = new Map<number, number>();
  const newLabel = () => nextLabel++;
  const mark = (label: number) => labels.set(label, code.length);
  // Jump targets are labels first and resolved to indices at the end.
  const emit = (instr: Instr, ...labelFields: string[]) => {
    code.push(instr);
    for (const field of labelFields) {
      fixups.push({ index: code.length - 1, label: (instr as unknown as Record<string, number>)[field]! });
    }
  };

  const steps = (list: Step[], fail: number) => {
    for (const step of list) {
      switch (step.op) {
        case "if": {
          const elseLabel = newLabel();
          const end = newLabel();
          emit({ op: "jumpUnless", cond: step.cond, to: elseLabel }, "to");
          steps(step.then, fail);
          emit({ op: "jump", to: end }, "to");
          mark(elseLabel);
          if (step.else) steps(step.else, fail);
          mark(end);
          break;
        }
        case "may": {
          const end = newLabel();
          emit({ op: "ask", to: end }, "to");
          steps(step.do, fail);
          mark(end);
          break;
        }
        case "choice": {
          const end = newLabel();
          const starts = step.options.map(() => newLabel());
          const pick: Instr = {
            op: "pick",
            options: step.options.map((o, i) => ({ label: o.label, to: starts[i]! })),
          };
          code.push(pick);
          for (const [i, option] of step.options.entries()) {
            mark(starts[i]!);
            steps(option.do, fail);
            emit({ op: "jump", to: end }, "to");
          }
          mark(end); // the pick's option labels are resolved below
          break;
        }
        default:
          emit({ ...step, fail } as Instr, "fail");
      }
    }
  };

  for (const segment of segments) {
    const end = newLabel();
    steps(segment, end);
    mark(end);
  }

  // Resolve labels. A pick instruction has several labels; map each option separately.
  for (const instr of code) {
    if (instr.op === "pick") for (const o of instr.options) o.to = labels.get(o.to) ?? code.length;
  }
  for (const { index, label } of fixups) {
    const instr = code[index]!;
    const target = labels.get(label);
    if (target === undefined) throw new Error(`unresolved label ${label}`);
    if ("to" in instr) instr.to = target;
    else if ("fail" in instr) instr.fail = target;
  }
  return code;
}

export interface CompiledEffect {
  effect: Effect;
  program: Program;
}

export function compileEffect(effect: Effect): CompiledEffect {
  return { effect, program: "segments" in effect ? compileSegments(effect.segments) : [] };
}
