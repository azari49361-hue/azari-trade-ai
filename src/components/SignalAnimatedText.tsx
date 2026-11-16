interface SignalAnimatedTextProps {
  text: string | number;
  mainSize?: string;
  textColor?: string;
  shadowColor?: string;
  shineColor?: string;
  className?: string;
}

export function SignalAnimatedText({
  text,
  mainSize = '0.85rem',
  textColor = '#e6edf3',
  shadowColor: _shadowColor,
  shineColor: _shineColor,
  className = '',
}: SignalAnimatedTextProps) {
  const content = typeof text === 'number' ? String(text) : text;
  return (
    <span
      className={`signal-animated-text ${className}`.trim()}
      style={{
        ['--sat-size' as string]: mainSize,
        ['--sat-color' as string]: textColor,
      }}
    >
      {content}
    </span>
  );
}
