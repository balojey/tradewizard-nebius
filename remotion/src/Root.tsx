import { Composition } from "remotion";
import { AnalysisDemo } from "./AnalysisDemo";
import { AnalysisReport } from "./AnalysisReport";
import { AutonomousTrading } from "./AutonomousTrading";
import { AnalysisDemoMobile } from "./mobile/AnalysisDemoMobile";
import { AnalysisReportMobile } from "./mobile/AnalysisReportMobile";
import { AutonomousTradingMobile } from "./mobile/AutonomousTradingMobile";

export const FPS = 30;
export const DURATION_IN_FRAMES = 420;

const mobile = {
  durationInFrames: DURATION_IN_FRAMES,
  fps: FPS,
  width: 900,
  height: 1125,
} as const;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="AnalysisDemo"
        component={AnalysisDemo}
        defaultProps={{ theme: "dark" }}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1600}
        height={1000}
      />
      <Composition
        id="AnalysisDemoLight"
        component={AnalysisDemo}
        defaultProps={{ theme: "light" }}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1600}
        height={1000}
      />
      <Composition
        id="AnalysisReport"
        component={AnalysisReport}
        defaultProps={{ theme: "dark" }}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1600}
        height={1000}
      />
      <Composition
        id="AnalysisReportLight"
        component={AnalysisReport}
        defaultProps={{ theme: "light" }}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1600}
        height={1000}
      />
      <Composition
        id="AutonomousTrading"
        component={AutonomousTrading}
        defaultProps={{ theme: "dark" }}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1600}
        height={1000}
      />
      <Composition
        id="AutonomousTradingLight"
        component={AutonomousTrading}
        defaultProps={{ theme: "light" }}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={1600}
        height={1000}
      />

      <Composition
        id="AnalysisDemoMobile"
        component={AnalysisDemoMobile}
        defaultProps={{ theme: "dark" }}
        {...mobile}
      />
      <Composition
        id="AnalysisDemoMobileLight"
        component={AnalysisDemoMobile}
        defaultProps={{ theme: "light" }}
        {...mobile}
      />
      <Composition
        id="AnalysisReportMobile"
        component={AnalysisReportMobile}
        defaultProps={{ theme: "dark" }}
        {...mobile}
      />
      <Composition
        id="AnalysisReportMobileLight"
        component={AnalysisReportMobile}
        defaultProps={{ theme: "light" }}
        {...mobile}
      />
      <Composition
        id="AutonomousTradingMobile"
        component={AutonomousTradingMobile}
        defaultProps={{ theme: "dark" }}
        {...mobile}
      />
      <Composition
        id="AutonomousTradingMobileLight"
        component={AutonomousTradingMobile}
        defaultProps={{ theme: "light" }}
        {...mobile}
      />
    </>
  );
};
