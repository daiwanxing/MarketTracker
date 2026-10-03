import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchTencentQuotes } from './_tencent.ts';
import { fetchSinaGlobalQuotes } from './_sina.ts';
import { fetchEastmoneyCrowding, fetchEastmoneyYields } from './_eastmoney.ts';

// 引入全站静态数据契约层，作为真实基准（替代任何手写硬编码数字）
import techSemiStatic from '../src/data/techSemiData.json' with { type: 'json' };
import robotStatic from '../src/data/robotData.json' with { type: 'json' };
import oilStatic from '../src/data/oilData.json' with { type: 'json' };
import goldStatic from '../src/data/goldData.json' with { type: 'json' };

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // 设置边缘缓存策略：全球 CDN 缓存 8 秒，20 秒内允许返回过期数据并在后台异步更新
  res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=20');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // 并发抓取国内三大原生行情源通道：
  // 1. 腾讯：A股、美股单票/ETF、原油黄金主力连续合约
  // 2. 新浪：全球费半SOX、韩国KOSPI、美元指数DXY、伦敦金现货XAU
  // 3. 东方财富：全市场拥挤度聚合 (TMT / 机器人)、美债10年期基准收益率
  const tencentSymbols = ['sh000688', 'sh562500', 'usTSLA', 'usROBO', 'hf_OIL', 'hf_CL', 'hf_GC'];

  const [tencentRes, sinaRes, crowdingRes, yieldsRes] = await Promise.allSettled([
    fetchTencentQuotes(tencentSymbols, 3500),
    fetchSinaGlobalQuotes(3500),
    fetchEastmoneyCrowding(3000),
    fetchEastmoneyYields(3000),
  ]);

  const tcMap = tencentRes.status === 'fulfilled' ? tencentRes.value : {};
  const sinaMap = sinaRes.status === 'fulfilled' ? sinaRes.value : {};
  const crowding = crowdingRes.status === 'fulfilled' ? crowdingRes.value : null;
  const yields = yieldsRes.status === 'fulfilled' ? yieldsRes.value : {};

  // 1. 科技半导体组装（绝不硬编码任何假数字，优先接口，降级严格取静态底包已核实真值）
  const staticSemiBm = techSemiStatic.benchmarks;
  const tcStar50 = tcMap['sh000688'];
  const techSemiData = {
    sox: {
      name: staticSemiBm.sox.name,
      symbol: staticSemiBm.sox.symbol,
      price: sinaMap.sox?.price ?? staticSemiBm.sox.price,
      chg: sinaMap.sox?.chg || staticSemiBm.sox.chg,
      chgClass: sinaMap.sox?.chgClass || staticSemiBm.sox.chgClass,
      previousClose: sinaMap.sox?.previousClose ?? staticSemiBm.sox.previousClose,
    },
    star50: {
      name: staticSemiBm.star50.name,
      symbol: staticSemiBm.star50.symbol,
      price: tcStar50?.price ?? staticSemiBm.star50.price,
      chg: tcStar50?.chg || staticSemiBm.star50.chg,
      chgClass: tcStar50?.chgClass || staticSemiBm.star50.chgClass,
      previousClose: tcStar50?.previousClose ?? staticSemiBm.star50.previousClose,
    },
    kospi: {
      name: staticSemiBm.kospi.name,
      symbol: staticSemiBm.kospi.symbol,
      price: sinaMap.kospi?.price ?? staticSemiBm.kospi.price,
      chg: sinaMap.kospi?.chg || staticSemiBm.kospi.chg,
      chgClass: sinaMap.kospi?.chgClass || staticSemiBm.kospi.chgClass,
      previousClose: sinaMap.kospi?.previousClose ?? staticSemiBm.kospi.previousClose,
    },
    crowding: crowding?.techSemi ?? {
      value: techSemiStatic.crowding.turnoverShare.value,
      tmtAmountYi: techSemiStatic.crowding.turnoverShare.tmtAmountYi,
      marketAmountYi: techSemiStatic.crowding.turnoverShare.marketAmountYi,
      zone: techSemiStatic.crowding.zone,
      label: techSemiStatic.crowding.label,
    },
  };

  // 2. 原油组装
  const tcOil = tcMap['hf_OIL'];
  const tcWti = tcMap['hf_CL'];
  const staticOilMetrics = oilStatic.metrics.main;
  const oilPrice = tcOil?.price ? tcOil.price.toFixed(2) : String(staticOilMetrics.num);
  const oilChg = tcOil?.chg || staticOilMetrics.chg;
  const oilChgClass = tcOil?.chgClass || staticOilMetrics.chgClass;
  const oilQuotes = {
    wti: tcWti?.price ?? staticOilMetrics.quotes?.wti,
    dxy: sinaMap.dxy ?? staticOilMetrics.quotes?.dxy,
  };

  // 3. 黄金组装
  const tcGc = tcMap['hf_GC'];
  const staticGoldMetrics = goldData_metrics();
  const staticUs10y = goldStatic.macro?.items?.find((item) => item.dim === 'rates')?.quote?.value;
  const goldPriceNum = sinaMap.spotGold ?? tcGc?.price ?? parseFloat(String(staticGoldMetrics.num));
  const goldPrice = goldPriceNum ? goldPriceNum.toFixed(2) : String(staticGoldMetrics.num);
  const goldChg = tcGc?.chg || staticGoldMetrics.chg;
  const goldChgClass = tcGc?.chgClass || staticGoldMetrics.chgClass;
  const goldQuotes = {
    gc: tcGc?.price ?? staticGoldMetrics.quotes?.gc,
    dxy: sinaMap.dxy ?? staticGoldMetrics.quotes?.dxy,
    us10y: yields.us10y ?? staticUs10y,
  };

  // 4. 机器人组装
  const staticRobotBm = robotStatic.benchmarks;
  const staticRobotOption = robotStatic.optionSentinel?.tsla;
  const tcCsRobot = tcMap['sh562500'];
  const tcRobo = tcMap['usROBO'];
  const tcTsla = tcMap['usTSLA'];

  const robotData = {
    csRobot: {
      name: staticRobotBm.csRobot.name,
      symbol: staticRobotBm.csRobot.symbol,
      price: tcCsRobot?.price ?? staticRobotBm.csRobot.price,
      chg: tcCsRobot?.chg || staticRobotBm.csRobot.chg,
      chgClass: tcCsRobot?.chgClass || staticRobotBm.csRobot.chgClass,
      previousClose: tcCsRobot?.previousClose ?? staticRobotBm.csRobot.previousClose,
    },
    robo: {
      name: staticRobotBm.robo.name,
      symbol: staticRobotBm.robo.symbol,
      price: tcRobo?.price ?? staticRobotBm.robo.price,
      chg: tcRobo?.chg || staticRobotBm.robo.chg,
      chgClass: tcRobo?.chgClass || staticRobotBm.robo.chgClass,
      previousClose: tcRobo?.previousClose ?? staticRobotBm.robo.previousClose,
    },
    tsla: {
      name: staticRobotOption?.name || '特斯拉 (TSLA)',
      symbol: staticRobotOption?.symbol || 'TSLA',
      price: tcTsla?.price ?? staticRobotOption?.price,
      chg: tcTsla?.chg || staticRobotOption?.chg,
      chgClass: tcTsla?.chgClass || staticRobotOption?.chgClass,
      previousClose: tcTsla?.previousClose ?? staticRobotOption?.previousClose,
    },
    crowding: crowding?.robot ?? {
      value: robotStatic.crowding.turnoverShare.value,
      robotAmountYi: robotStatic.crowding.turnoverShare.robotAmountYi,
      marketAmountYi: robotStatic.crowding.turnoverShare.marketAmountYi,
      zone: robotStatic.crowding.zone,
      label: robotStatic.crowding.label,
    },
  };

  return res.status(200).json({
    status: 'ok',
    asOf: new Date().toISOString(),
    oil: {
      price: oilPrice,
      chg: oilChg,
      chgClass: oilChgClass,
      quotes: oilQuotes,
    },
    gold: {
      price: goldPrice,
      chg: goldChg,
      chgClass: goldChgClass,
      quotes: goldQuotes,
    },
    techSemi: techSemiData,
    robot: robotData,
  });
}

function goldData_metrics() {
  return goldStatic.metrics.main;
}
