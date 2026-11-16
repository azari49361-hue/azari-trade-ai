import React from 'react';

interface SlicedTextProps {
  text: string;
  mainSize?: string; // e.g. '1.2rem', '0.7rem'
  textColor?: string;
  shadowColor?: string;
  shineColor?: string;
  width?: string;
  className?: string;
}

/**
 * افکت متن برشی/انیمیشنی (سفارشی‌شده بر اساس کد کاربر) برای نمایش عناوین و وضعیت‌ها.
 */
export const SlicedText: React.FC<SlicedTextProps> = ({
  text,
  mainSize = '1rem',
  textColor = '#ffffff',
  shadowColor = '#8aa4b8',
  shineColor = '#ffffff40',
  width,
  className = '',
}) => {
  const style: React.CSSProperties & Record<string, string> = {
    ['--main-size']: mainSize,
    ['--text-color']: textColor,
    ['--shine-color']: shineColor,
    ['--shadow-color']: shadowColor,
  };
  if (width) style.width = width;

  return (
    <div className={`sliced-loader ${className}`} style={style} aria-label={text} title={text}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div className="text" key={i}>
          <span>{text}</span>
        </div>
      ))}
      <div className="line" />
    </div>
  );
};
