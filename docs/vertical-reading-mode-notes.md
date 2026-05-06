# Vertical Reading Mode Notes

## Goal

Add an optional vertical Japanese reading mode without disrupting the current horizontal reading layout.

The preferred first version should affect only the reading surface, not the whole application:

- Keep bookshelf, store, settings, dialogs, dictionary popup, and metadata UI horizontal.
- Let the novel body switch between horizontal and vertical layout.
- Persist the user's layout preference.
- Keep the current horizontal mode as the default and stable path.

## Recommended Scope

Start with a focused "vertical reading experiment" rather than full publication-grade Japanese typesetting.

Minimum useful version:

- Add a `縦書き` setting in the reader settings panel.
- Apply vertical mode to `#novel-content` / `.novel-text`.
- Use CSS such as `writing-mode: vertical-rl` and `text-orientation: mixed`.
- Keep reader controls horizontal: back button, status bar, settings panel.
- Adapt progress tracking for vertical scroll behavior.
- Test specifically on Android WebView and mobile browsers.

This is likely a medium-sized feature, not a trivial CSS-only change.

## Main Implementation Areas

### Layout

The core layout can probably be implemented with CSS:

```css
.novel-text.vertical {
    writing-mode: vertical-rl;
    text-orientation: mixed;
}
```

But the surrounding reader layout will need constraints so the vertical content has a stable reading area and does not collide with controls.

### Scrolling

This is the biggest behavior change.

Horizontal mode currently assumes normal vertical scrolling. Vertical Japanese layout often creates horizontal overflow and expects left/right movement. The app needs to decide whether vertical mode uses:

- Native horizontal scrolling.
- Page-like horizontal steps.
- A custom navigation layer.

For the first version, native horizontal scrolling is the simplest option, but Android WebView behavior must be tested.

### Progress

Current reading progress is based on vertical position and paragraph visibility. In vertical mode, progress may need to use horizontal measurements such as `scrollLeft`, paragraph `left/right`, or container width.

Progress logic should branch by layout mode instead of trying to reuse the horizontal calculation blindly.

### Ruby / Furigana

Browser ruby support generally works with vertical writing, but details vary across browser engines and Android WebView.

Potential issues:

- `rt` placement may differ from desktop browsers.
- Existing ruby hiding/showing CSS may need adjustment.
- The contrasting ruby font rule should still apply in vertical mode.
- Auto-generated Kuromoji ruby and Aozora ruby should both be tested.

### Mixed Content

Some content should probably stay horizontal even when the novel body is vertical:

- Translation lines.
- Dictionary popups.
- Settings panel.
- Book info cards.
- Metadata/frontmatter.

Otherwise the UI may become harder to read and harder to operate.

### Text Details

Publication-quality vertical Japanese typography has many extra details that CSS alone may not fully solve:

- Japanese punctuation placement.
- Brackets and quotes.
- Numbers.
- Latin text.
- Emphasis marks.
- Line breaking and prohibited line breaks.

These should be treated as later polish, not MVP blockers.

## What Is Practical

Practical for a first release:

- Toggle vertical mode for novel body.
- Preserve horizontal UI around the reader.
- Basic vertical ruby rendering.
- Basic progress tracking.
- Basic Android/Web testing.

Possible later:

- Better page-step navigation.
- Dedicated vertical mode controls.
- Improved punctuation and mixed-script handling.
- Better popup positioning in vertical layout.

## What Not To Do First

Avoid these in the first implementation:

- Whole-app vertical layout.
- Full book-like double-page layout.
- Canvas-based custom text engine.
- Full publication-grade Japanese composition.
- Making translation and dialogs vertical.
- Replacing current horizontal reader behavior.

Those would turn the feature into a much larger layout engine project.

## Risk Summary

Main risks:

- Android WebView horizontal scrolling may feel awkward.
- Progress tracking needs a separate vertical-mode branch.
- Ruby placement may need browser-specific tuning.
- Popup positioning may be wrong if it assumes horizontal text flow.
- The feature can accidentally affect non-reader UI unless selectors are tightly scoped.

## Suggested Plan

1. Add a saved vertical-mode setting.
2. Add scoped CSS for `.novel-text.vertical`.
3. Keep all surrounding UI horizontal.
4. Implement vertical-mode progress calculation separately.
5. Test Aozora ruby, Kuromoji ruby, popup behavior, and Android scrolling.
6. Only after the MVP works, consider page-like navigation and typography polish.
