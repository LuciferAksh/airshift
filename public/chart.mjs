import { formatTime } from './planner.mjs';

export function drawChart(canvas, forecast, suggestedHour) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context || !forecast || width < 80) return;
  context.scale(scale, scale);

  const inset = 36;
  const bottom = height - 26;
  const chartHeight = bottom - 10;
  const step = (width - inset - 4) / 24;
  const max = Math.max(...forecast.hours.map(({ pm }) => pm));
  const top = Math.max(40, Math.ceil(max / 40) * 40);
  context.font = '11px system-ui';

  for (let row = 0; row <= 4; row += 1) {
    const y = bottom - (chartHeight * row / 4);
    context.strokeStyle = '#e1e8df';
    context.beginPath();
    context.moveTo(inset - 2, y);
    context.lineTo(width, y);
    context.stroke();
    context.fillStyle = '#52645a';
    context.textAlign = 'right';
    context.fillText(String(top * row / 4), inset - 8, y + 4);
  }
  for (const point of forecast.hours) {
    const x = inset + (point.time + .14) * step;
    const barHeight = Math.max(1, chartHeight * point.pm / top);
    context.fillStyle = point.time === suggestedHour ? '#316146' : '#aebcaf';
    context.beginPath();
    context.roundRect(x, bottom - barHeight, step * .72, barHeight, [2, 2, 0, 0]);
    context.fill();
  }
  for (const hour of [0, 4, 8, 12, 16, 20]) {
    context.fillStyle = '#52645a';
    context.textAlign = 'left';
    context.fillText(formatTime(hour * 60), inset + hour * step, height - 5);
  }
}
