# Bridge UI and UX guidelines

Bridge should feel calm, precise, trustworthy, and fast. It is a transfer utility, not a dashboard. The interface should reduce uncertainty around three questions: **what can I do, what is happening, and is my transfer safe?**

## Product principles

1. **Purpose before decoration.** The pairing and transfer task stays visually dominant. Decorative depth, gradients, and motion may clarify hierarchy but must not compete with the task.
2. **Strong hierarchy.** Each state should expose one obvious primary action, with secondary actions visibly quieter. Connection and transfer status should remain easy to scan without becoming the visual centerpiece.
3. **Progressive disclosure.** Security, route, device naming, and advanced privacy details should be available when useful without making first-use pairing feel technical.
4. **Continuous feedback.** Pairing, connection, acceptance, progress, interruption, recovery, completion, cancellation, and failure all need explicit visible state. Do not rely on animation or color alone.
5. **Forgiving interaction.** Destructive or interruptive actions should be reversible where practical. Cancellation must be clear and bounded. Network loss should preserve context and explain recovery rather than silently resetting the UI.
6. **Accessibility is structural.** Keyboard access, visible focus, screen-reader naming/status, reduced motion, forced colors, text zoom, non-text contrast, and comfortable target sizes are release requirements, not polish items.
7. **Platform familiarity.** Use ordinary verbs and familiar controls. Native file dialogs and browser capabilities should remain native rather than being visually reimplemented.
8. **Restraint communicates quality.** Prefer a small number of carefully tuned surfaces, borders, radii, shadows, colors, and motion timings over ornamental variety.

These principles align with current Apple Human Interface Guidance around purpose, agency, simplicity, familiarity, flexibility, craft and delight; W3C WCAG 2.2 guidance around focus visibility, target size and accessible status; and established usability principles around system-status visibility, error prevention, feedback and progressive disclosure.

## Visual system

The canonical visual tokens live in `src/style.css` under `:root`. New UI should consume the semantic tokens before adding new literal colors or one-off spacing values.

- Backgrounds progress from `--bg` to `--surface`, `--surface-raised`, and `--surface-strong`.
- `--text`, `--text-secondary`, `--text-muted`, and `--text-faint` define text hierarchy.
- `--accent` and `--accent-strong` communicate action and focus. Accent use should stay sparse.
- Status colors are reserved for meaningful success, warning, and danger semantics.
- `--border` and `--border-strong` define most component boundaries.
- `--radius-*`, `--space-*`, and shadow tokens keep geometry consistent.

The visual direction is a restrained midnight/graphite interface with cool blue interaction accents. Surfaces use subtle depth rather than heavy glass effects. The pairing card is the strongest surface; status and queue panels sit one level lower.

## Interaction hierarchy

The first actionable transfer control is visually primary. Other actions remain visible but quieter. On the Receive Portal, the four sender actions share a compact grid because they represent equivalent content types after the initial file action.

Buttons should normally provide at least a 44px comfortable touch target. Compact utility controls can be smaller only when they are secondary, well-spaced, and remain compliant with the current accessibility policy.

Keyboard focus must never be removed for cosmetic reasons. Focus rings use the shared high-contrast focus token and a 3px outline with offset. Any overlay or disclosure added later must keep focused elements visible and restore focus when closed.

Settings that interrupt or restart the active session must not take effect as a side effect of toggling a control. Stage the changed value, explain the consequence in visible and assistive status text, and require an explicit apply action. A cancel action should restore the persisted value and return focus to the setting.

## Responsive behavior

Bridge is mobile-first at the interaction level even though desktop pairing has more space. Layout should remain usable at 320 CSS px without horizontal page scrolling. At narrow widths:

- Pairing content stacks into one column.
- QR and supporting copy center for scanability.
- Request actions can wrap or stack rather than compressing labels.
- Receive Portal actions collapse from two columns to one on very small screens.
- Transfer filenames truncate within their row instead of widening the page.

At 200% browser zoom, the same principles apply: preserve reading order and interaction context rather than trying to preserve desktop density.

## Motion and depth

Motion is limited to short state transitions and direct manipulation feedback. Hover elevation is one pixel; there are no ambient animations. `prefers-reduced-motion` reduces transitions to effectively zero.

Depth should indicate hierarchy, not visual fashion. The pairing card may have the strongest shadow, utility panels use shallow inset separation, and controls use restrained hover elevation. Avoid adding glass/transparency to every panel.

## Content design

Use direct, action-oriented labels. Prefer `Send files`, `Request something`, `Save to disk`, `Receive in browser`, `Decline`, and `Cancel` over clever or branded language.

Explain security in plain language only where it reduces uncertainty. Avoid protocol terms such as ICE, SDP, HKDF, AES-GCM, or rendezvous in the primary interface. Route information may remain concise (`Direct` / `Relayed`) with detailed explanations in documentation or optional help.

Errors should state what happened and what the user can do next. Success states should be quiet and conclusive rather than celebratory.

## Maintainability rules

- Prefer existing semantic tokens and component patterns before creating new ones.
- Keep selectors component-oriented; avoid styling by deep DOM ancestry.
- Preserve stable IDs and accessibility attributes used by e2e tests.
- New visual states must include keyboard, reduced-motion, forced-colors, zoom, and narrow-screen consideration.
- Do not replace native browser dialogs merely to make them look branded.
- Avoid introducing a UI framework solely for presentation. Vanilla TypeScript remains appropriate while Bridge stays a focused single-surface utility.
- If the application grows into multiple routes or significantly more interactive surfaces, split the current presentation/controller layer into focused view/controller modules before adding a framework.

## Review checklist for future UI changes

A change is ready when the primary action remains obvious, state feedback is explicit, controls are keyboard reachable, focus is visible and unobscured, text and non-text contrast remain sufficient, target sizes remain comfortable, 320px and 200% zoom remain usable, reduced motion is respected, forced-colors mode remains understandable, disruptive settings require explicit application, and new styling uses the shared design language instead of adding one-off visual rules.
