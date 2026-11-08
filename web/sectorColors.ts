/**
 * 板块配色：按行业属性分冷暖族，族内用连续深浅色阶区分。
 *
 * 设计目标：列内「折叠全部板块」时也能一眼分出板块所属方向，
 * 并且同一板块在 12 个月里颜色固定，方便横向追踪同一条主线。
 */

export type SectorFamily =
  | 'tech' | 'newenergy' | 'health' | 'consumer' | 'cycle' | 'finance' | 'misc';

export interface SectorColor {
  family: SectorFamily;
  /** 组头底色（马卡龙浅色） */
  bg: string;
  /** 色条 / 色点（同色系加深） */
  accent: string;
}

interface FamilyDef {
  id: SectorFamily;
  label: string;
  /** 族内第 1 级的色相 */
  hue: number;
  /** 族内色相跨度 */
  hueSpan: number;
  /** 族内第 1 级的饱和度 / 每级下降 */
  sat: number;
  satDrop: number;
  /** 族内第 1 级的明度 / 每级下降 */
  light: number;
  lightDrop: number;
}

/** 马卡龙＝低饱和 + 高明度；冷暖靠色相分族，族内靠明度深浅再分 */
const FAMILIES: Record<SectorFamily, FamilyDef> = {
  tech: { id: 'tech', label: '科技', hue: 198, hueSpan: 26, sat: 72, satDrop: 16, light: 87, lightDrop: 23 },
  newenergy: { id: 'newenergy', label: '新能源', hue: 92, hueSpan: 22, sat: 64, satDrop: 14, light: 88, lightDrop: 23 },
  health: { id: 'health', label: '医药健康', hue: 152, hueSpan: 20, sat: 54, satDrop: 12, light: 88, lightDrop: 22 },
  consumer: { id: 'consumer', label: '消费', hue: 340, hueSpan: 24, sat: 64, satDrop: 12, light: 88, lightDrop: 23 },
  cycle: { id: 'cycle', label: '周期制造', hue: 18, hueSpan: 28, sat: 70, satDrop: 14, light: 87, lightDrop: 23 },
  finance: { id: 'finance', label: '金融地产', hue: 270, hueSpan: 20, sat: 44, satDrop: 10, light: 89, lightDrop: 21 },
  misc: { id: 'misc', label: '其他', hue: 46, hueSpan: 10, sat: 34, satDrop: 8, light: 89, lightDrop: 19 },
};

/** 顺序即优先级：先命中先归属族 */
const RULES: Array<{ family: SectorFamily; words: string[] }> = [
  {
    family: 'tech',
    words: [
      'AI', '人工智能', '大模型', '智能体', '算力', '芯片', '半导体', '集成电路', '晶圆',
      '封测', '先进封装', '存储', '光模块', 'CPO', '光通信', '光刻', '通信', '5G', '基站',
      '数据中心', '云计算', '软件', '操作系统', '鸿蒙', '信创', '计算机', '互联网', '元宇宙',
      '量子', '区块链', '数字经济', '数字化', '游戏', '短剧', '传媒', '影视', '出版', '机器人',
      '机器视觉', '传感器', '消费电子', 'PCB', '面板', 'LED', '光学', '镜头', '电子', '显示',
      '音响', '耳机', '手机', '可穿戴', '卫星', '导航', '测绘', '智能驾驶', '无人', '智驾',
      '液冷', 'IDC', '光刻胶', 'MCU', '封板',
    ],
  },
  {
    family: 'newenergy',
    words: [
      '光伏', '风电', '储能', '锂电', '电池', '新能源', '氢能', '核电', '钠电', '充电',
      '逆变器', '组件', '硅料', '多晶硅', '碳酸锂', '正极', '负极', '隔膜', '电解液', '特高压',
      '电网', '换电', '风电设备', 'TOPCon', 'HJT', '固态电池', '电力', '虚拟电厂',
    ],
  },
  {
    family: 'health',
    words: [
      '医药', '医疗', '生物', '疫苗', '中药', '药', '器械', '创新药', 'CXO', '医美', '血制品',
      '原料药', '减肥药', '眼科', '口腔', '保健', '医院', ' CRO ',
    ],
  },
  {
    family: 'consumer',
    words: [
      '消费', '零售', '商贸', '商业', '食品', '饮料', '白酒', '酒', '乳业', '农业', '种业',
      '养殖', '猪', '鸡', '牛', '肉', '家居', '家具', '家电', '纺织', '服装', '鞋', '帽',
      '箱包', '造纸', '包装', '塑料', '橡胶', '旅游', '酒店', '餐饮', '免税', '教育', '美容',
      '美妆', '日化', '宠物', '玩具', '珠宝', '母婴', '烟', '调味', '茶', '咖啡', '烘焙',
    ],
  },
  {
    family: 'cycle',
    words: [
      '化工', '化学', '有色', '金属', '钢铁', '煤', '石油', '石化', '稀土', '黄金', '铜', '铝',
      '锌', '镍', '钴', '锂矿', '材料', '元器件', '玻璃', '水泥', '建材', '基建', '机械',
      '装备', '制造', '工程', '电气', '电机', '汽车', '整车', '轮胎', '军工', '兵器', '航天',
      '船舶', '航空', '物流', '港口', '航运', '仓储', '砂石', '工业', '智能制造', '仪器',
    ],
  },
  {
    family: 'finance',
    words: [
      '银行', '券商', '证券', '保险', '金融', '地产', '城建', '房', '物业', '租赁', '创投',
      '信托', '多元金融', 'AMC',
    ],
  },
];

/** 每个色系的色阶数：颜色不够用时靠深浅继续分 */
const STEPS = 12;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 按行业关键词判定板块属于哪个色系（冷 / 暖 / 中性） */
export function sectorFamily(sector: string): SectorFamily {
  const name = sector.toLowerCase();
  for (const rule of RULES) {
    for (const word of rule.words) {
      if (name.includes(word.toLowerCase())) return rule.family;
    }
  }
  return 'misc';
}

/**
 * 色系图例：每族取第 1 级色作为代表色，用于页面上的冷暖说明。
 */
export function familyLegend(): Array<{
  family: SectorFamily; label: string; bg: string; accent: string;
}> {
  return Object.values(FAMILIES).map((def) => ({
    family: def.id,
    label: def.label,
    bg: `hsl(${def.hue} ${def.sat}% ${def.light}%)`,
    accent: `hsl(${def.hue} ${Math.min(def.sat + 12, 88)}% ${Math.max(def.light - 22, 34)}%)`,
  }));
}

/**
 * 同板块个股的配色：抽屉里叠加 K 线时，每只股票一种颜色。
 *
 * 色相按黄金角（137.508°）散开，保证相邻编号的两只票色相差距最大；
 * 再用明度 / 饱和度分档补足区分度（单靠色相在 80+ 只时必然撞色）。
 * 基准色相取板块所属色系，既多样又保留板块的冷暖倾向。
 */
export function buildStockColors(sector: string, codes: string[]): Map<string, string> {
  const def = FAMILIES[sectorFamily(sector)];
  const map = new Map<string, string>();
  codes.forEach((code, index) => {
    const hue = (def.hue + 18 + index * 137.508) % 360;
    const sat = 46 + (index % 3) * 9;
    const light = 56 + (index % 4) * 5;
    map.set(code, `hsl(${hue.toFixed(1)} ${sat}% ${light}%)`);
  });
  return map;
}

/**
 * 生成「板块 → 颜色」映射。
 * 同一板块在所有月份共用同一颜色；族内按板块名排序分配连续深浅色阶，
 * 超出色阶数时循环并整体微调色相/明度，保证相邻板块仍可分辨。
 */
export function buildSectorColors(sectors: Iterable<string>): Map<string, SectorColor> {
  const byFamily = new Map<SectorFamily, string[]>();
  for (const sector of sectors) {
    const family = sectorFamily(sector);
    const list = byFamily.get(family) ?? [];
    list.push(sector);
    byFamily.set(family, list);
  }

  const result = new Map<string, SectorColor>();
  for (const [family, list] of byFamily) {
    const def = FAMILIES[family];
    const sorted = [...list].sort((a, b) => a.localeCompare(b, 'zh'));
    sorted.forEach((sector, index) => {
      const step = index % STEPS;
      const round = Math.floor(index / STEPS);
      const t = STEPS > 1 ? step / (STEPS - 1) : 0;
      const hue = def.hue + t * def.hueSpan + round * 5;
      const sat = clamp(def.sat - t * def.satDrop + round * 4, 18, 82);
      const light = clamp(def.light - t * def.lightDrop + round * 3, 52, 92);
      result.set(sector, {
        family,
        bg: `hsl(${hue.toFixed(1)} ${sat.toFixed(1)}% ${light.toFixed(1)}%)`,
        accent: `hsl(${hue.toFixed(1)} ${clamp(sat + 12, 18, 88).toFixed(1)}% ${clamp(light - 22, 34, 80).toFixed(1)}%)`,
      });
    });
  }
  return result;
}
