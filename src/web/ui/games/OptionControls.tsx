import { useId, useRef, type KeyboardEvent } from 'react'
import { Icon } from '../icons'
import type { Choice, ControlSpec, GameEntry, OptionValue, OptionValues } from './catalog'

interface Props {
  entry: GameEntry
  values: OptionValues
  onChange: (key: string, value: OptionValue) => void
}

/** Todos os controles de opção do jogo, na ordem do catálogo. Some o que o catálogo esconde (`when`). */
export function OptionControls({ entry, values, onChange }: Props) {
  const shown = entry.controls.filter((c) => !c.when || c.when(values))
  if (shown.length === 0) {
    return <p className="games-noopts muted small">Este jogo não tem opções: é só abrir e chamar a turma.</p>
  }
  return (
    <div className="games-opts">
      {shown.map((c) => (
        <Field key={c.key} spec={c} values={values} onChange={onChange} />
      ))}
    </div>
  )
}

function Field({ spec, values, onChange }: { spec: ControlSpec; values: OptionValues; onChange: Props['onChange'] }) {
  const labelId = useId()
  const v = values[spec.key]
  const half = spec.kind === 'stepper' || spec.kind === 'switch'
  let hint: string | undefined
  let body: React.ReactNode
  if (spec.kind === 'segment') {
    hint = spec.choices.find((c) => c.value === v)?.sub
    body = <Segment labelId={labelId} choices={spec.choices} value={v} onPick={(x) => onChange(spec.key, x)} />
  } else if (spec.kind === 'cards') {
    hint = undefined
    body = <ChoiceCards labelId={labelId} choices={spec.choices} value={v} onPick={(x) => onChange(spec.key, x)} />
  } else if (spec.kind === 'stepper') {
    const n = typeof v === 'number' ? v : spec.min
    hint = spec.sub?.(n)
    body = <Stepper labelId={labelId} spec={spec} value={n} onPick={(x) => onChange(spec.key, x)} />
  } else if (spec.kind === 'switch') {
    const on = v === true
    hint = on ? spec.onSub : spec.offSub
    body = <Switch labelId={labelId} spec={spec} on={on} onPick={(x) => onChange(spec.key, x)} />
  } else {
    const picked = Array.isArray(v) ? v : []
    hint = spec.hint
    body = (
      <div className="games-chips" role="group" aria-labelledby={labelId}>
        {spec.items.map((it) => {
          const on = picked.includes(it.value)
          return (
            <button
              key={it.value}
              type="button"
              className={`games-chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              disabled={on && picked.length <= spec.min}
              onClick={() => onChange(spec.key, spec.items.map((x) => x.value).filter((id) => (id === it.value ? !on : picked.includes(id))))}
            >
              {on && <Icon name="check" size={14} />}
              {it.label}
            </button>
          )
        })}
      </div>
    )
  }
  return (
    <div className={`games-field ${half ? '' : 'wide'}`}>
      <div className="games-field-head">
        <span id={labelId} className="games-field-label">
          <Icon name={spec.icon} size={15} />
          {spec.label}
        </span>
        {hint && !half && <small className="games-field-hint">{hint}</small>}
      </div>
      {body}
      {hint && half && <small className="games-field-hint is-below">{hint}</small>}
    </div>
  )
}

/** Navega por setas dentro de um grupo de rádios (um só foco por vez). */
function useRadioKeys(count: number, index: number, pick: (i: number) => void) {
  const root = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % count
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + count) % count
    else return
    e.preventDefault()
    e.stopPropagation()
    pick(next)
    root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }
  return { root, onKeyDown }
}

function Segment({ labelId, choices, value, onPick }: { labelId: string; choices: readonly Choice[]; value: OptionValue | undefined; onPick: (v: Choice['value']) => void }) {
  const index = Math.max(0, choices.findIndex((c) => c.value === value))
  const { root, onKeyDown } = useRadioKeys(choices.length, index, (i) => onPick(choices[i]!.value))
  return (
    <div ref={root} className="games-seg" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown} style={{ '--n': choices.length, '--i': index } as React.CSSProperties}>
      <span className="games-seg-thumb" aria-hidden="true" />
      {choices.map((c, i) => (
        <button key={String(c.value)} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1} className={`games-seg-opt ${i === index ? 'on' : ''}`} onClick={() => onPick(c.value)}>
          {c.label}
        </button>
      ))}
    </div>
  )
}

function ChoiceCards({ labelId, choices, value, onPick }: { labelId: string; choices: readonly Choice[]; value: OptionValue | undefined; onPick: (v: Choice['value']) => void }) {
  const index = Math.max(0, choices.findIndex((c) => c.value === value))
  const { root, onKeyDown } = useRadioKeys(choices.length, index, (i) => onPick(choices[i]!.value))
  return (
    <div ref={root} className="games-pick" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKeyDown} style={{ '--n': choices.length } as React.CSSProperties}>
      {choices.map((c, i) => (
        <button key={String(c.value)} type="button" role="radio" aria-checked={i === index} tabIndex={i === index ? 0 : -1} className={`games-pick-opt ${i === index ? 'on' : ''}`} onClick={() => onPick(c.value)}>
          <span className="games-pick-art" aria-hidden="true">
            {c.art ? <ArenaArt platforms={c.art} /> : <Icon name={c.icon ?? 'flag'} size={26} />}
          </span>
          <span className="games-pick-name">{c.label}</span>
          {c.sub && <small className="games-pick-sub">{c.sub}</small>}
          <span className="games-pick-check" aria-hidden="true">
            <Icon name="check" size={12} />
          </span>
        </button>
      ))}
    </div>
  )
}

/** Miniatura da arena: as plataformas reais (a cena desenha exatamente esta geometria). */
function ArenaArt({ platforms }: { platforms: NonNullable<Choice['art']> }) {
  return (
    <svg viewBox="40 40 400 230" width="100%" height="100%" shapeRendering="crispEdges" preserveAspectRatio="xMidYMid meet">
      {platforms.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={p.thin ? 10 : p.h} fill="currentColor" opacity={p.thin ? 0.7 : 1} />
      ))}
    </svg>
  )
}

function Stepper({ labelId, spec, value, onPick }: { labelId: string; spec: Extract<ControlSpec, { kind: 'stepper' }>; value: number; onPick: (n: number) => void }) {
  return (
    <div className="games-step" role="group" aria-labelledby={labelId}>
      <button type="button" className="games-step-btn" aria-label={`Menos: ${spec.label}`} disabled={value <= spec.min} onClick={() => onPick(Math.max(spec.min, value - 1))}>
        <span aria-hidden="true">−</span>
      </button>
      <output className="games-step-val" aria-live="polite">
        {spec.format(value)}
      </output>
      <button type="button" className="games-step-btn" aria-label={`Mais: ${spec.label}`} disabled={value >= spec.max} onClick={() => onPick(Math.min(spec.max, value + 1))}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  )
}

function Switch({ labelId, spec, on, onPick }: { labelId: string; spec: Extract<ControlSpec, { kind: 'switch' }>; on: boolean; onPick: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-labelledby={labelId} className={`games-switch ${on ? 'on' : ''}`} onClick={() => onPick(!on)}>
      <span className="games-switch-track" aria-hidden="true">
        <i />
      </span>
      <span className="games-switch-text">{on ? spec.on : spec.off}</span>
    </button>
  )
}
