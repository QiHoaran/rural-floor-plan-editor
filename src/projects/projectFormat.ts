// 索引页共用的展示格式化：卡片与详情弹窗都要用，且必须在模块级复用 Intl 实例
// （465 张卡片每次渲染都新建 formatter 会明显拖慢列表）。

export const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_review: '待审核',
  reviewed: '已审核',
  complete: '已完成',
};

const PROJECT_DATE_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function formatProjectDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return PROJECT_DATE_FORMAT.format(date);
}
