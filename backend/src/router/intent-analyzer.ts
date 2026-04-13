import type { IntentType } from "../types/index.js";

// 匹配顺序：从具体到宽泛，避免被过早匹配
const INTENT_PATTERNS: { intent: IntentType; patterns: RegExp[] }[] = [
  // 1. math - 纯数学计算（最高优先级，避免 "1+1等于几" 被 simple_qa 抢）
  { intent: "math", patterns: [
    /^\s*\d+\s*[\+\-\*\/\^]\s*\d+\s*[=等于几]+\s*[?？]?\s*$/i,  // 纯算术
    /计算|求解|方程|积分|微分|概率|统计|矩阵|几何|证明|数学|公式|定理|推导|化简|求值/i,
    /解方程|求根|最大值|最小值|极限|导数|偏导|泰勒展开|傅里叶变换/i,
    /[∫∑∏√∂∇∞±×÷]/,
    /黎曼猜想|费马大定理|哥德巴赫猜想|庞加莱猜想|NP完全|P vs NP/i,
  ]},

  // 2. code - 代码相关
  { intent: "code", patterns: [
    /```[\s\S]*```/,  // 代码块
    /function\s*\(|def\s+\w+\s*\(|class\s+\w+|import\s+\w+|console\.|print\(/i,
    /写代码|编程|代码|bug|debug|编译|算法|python|javascript|typescript|java|golang|rust|c\+\+|csharp/i,
    /实现.*算法|写.*程序|写.*函数|写.*类|写.*脚本|代码.*优化|重构.*代码/i,
    /quicksort|bubble sort|binary search|dfs|bfs|dp|dynamic programming|递归|迭代/i,
  ]},

  // 3. research - 研究/调研类（放在 reasoning 之前，避免被吞）
  { intent: "research", patterns: [
    /调研|研究|市场.*分析|竞争.*分析|趋势.*分析|行业.*报告|市场.*报告|综述|现状|发展.*趋势|格局|行业|领域|调查/i,
    /research|market research|competitive analysis|landscape|industry analysis|market share/i,
    /2024|2025|2026|最新|当前|目前.*情况|近年来|发展趋势|未来.*年|预测/i,
    /英伟达|nvidia|amd|英特尔|intel|特斯拉|苹果|谷歌|微软|亚马逊|阿里|腾讯|字节|meta/i,
    /市场份额|市场占有率|竞品|竞争对手|市场格局|产业.*分析/i,
  ]},

  // 4. reasoning - 深度分析/推理
  { intent: "reasoning", patterns: [
    /分析.*原因|比较.*区别|对比.*差异|评估.*优劣|权衡.*利弊|深入.*分析|本质.*区别/i,
    /analyze|compare|contrast|evaluate|why |how does|difference between|pros and cons/i,
    /有什么(区别|不同|优势|劣势|联系|关系)|哪个更好|怎么选|如何判断|影响因素/i,
    /versus|vs\.|better than|compared to|on the other hand|in contrast|trade-off|tradeoff/i,
    /意义|价值|影响|结果|后果|推导|结论|论证过程|逻辑|因果关系/i,
  ]},

  // 5. creative - 创作类
  { intent: "creative", patterns: [
    /写文章|写故事|诗歌|小说|创作|编写|起草|文案|标题|slogan|营销|广告|剧本|情书|演讲稿/i,
    /帮我写|给我写|写一首|写一段|写一篇|写个.*故事|编个.*故事|创作.*作品/i,
    /write.*story|write.*poem|write.*essay|creative writing|brainstorm ideas/i,
  ]},

  // 6. translation - 翻译
  { intent: "translation", patterns: [
    /翻译|translate|英译中|中译英|译成|译成中文|译成英文|翻成/i,
    /translate.*to|translation of|in chinese|in english/i,
  ]},

  // 7. summarization - 总结
  { intent: "summarization", patterns: [
    /总结|概括|摘要|归纳|提炼|summarize|summary|tl;dr|太长不看|简要|概述/i,
    /总结.*要点|概括.*内容|提取.*关键|归纳.*主要/i,
  ]},

  // 8. simple_qa - 简单问答（放在 chat 之前，但要避免太宽泛）
  { intent: "simple_qa", patterns: [
    // 明确的定义类问题
    /是什么|是谁|在哪|多少|什么时候|怎么样|哪个|哪里|几个|几点|多久|多贵|多重|多高|多大/i,
    /what is|who is|where is|when|how much|how many|which|what's|who's|where's|how old|how long/i,
    /的定义|的含义|是指|指的是|什么叫|什么是|意思是/i,
    // 80字符以内的纯问题（排除数学计算）
    /^[^\d\+\-\*\/]{0,80}[?？]\s*$/,
  ]},

  // 9. chat - 闲聊（扩大覆盖）
  { intent: "chat", patterns: [
    /^(你好|hi|hello|hey|嗨|早上好|晚上好|谢谢|感谢|再见|拜拜|ok|好的|明白|嗯|哦|哈)/i,
    /今天.*天气|天气.*怎么样|心情|最近|怎么了|有什么|聊聊|随便|无聊|好久不见|最近好吗/i,
    /how are you|what's up|good morning|good night|thanks|thank you|nice to meet/i,
    /在吗|在不在|忙吗|有空吗|打扰一下|不好意思|请问一下/i,
    /哈哈|嘿嘿|呵呵|嘻嘻|笑死|绝了|厉害|不错|可以|行|好|嗯嗯|哦哦/i,
  ]},
];

export function analyzeIntent(query: string): IntentType {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(query)) return intent;
    }
  }
  return "unknown";
}

export function hasCode(query: string): boolean {
  return /```|function\s*\(|def\s+\w+\s*\(|class\s+\w+|import\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|print\(|console\./.test(query);
}

export function hasMath(query: string): boolean {
  return /[∫∑∏√∂∇∞±×÷]|\d+\s*[\+\-\*\/\^]\s*\d+|方程|积分|矩阵|求导|极限|概率|统计/.test(query);
}
