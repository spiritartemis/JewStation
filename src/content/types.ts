/** 内容源结构（B-2.8：文案从内容源读取，不硬编码在组件里） */

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "note"; text: string };

export type Doc = {
  slug: string;
  title: string;
  /** 审核状态：policy 类一律 pending_review，未审核不进上线范围（B-1.8） */
  status: "draft" | "pending_review" | "approved";
  updatedAt: string;
  blocks: Block[];
};
