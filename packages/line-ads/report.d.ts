export type Report = {
  paging: { page: number; size: number; totalElements: number };
  datas: [
    {
      adaccount: {
        id: string;
        name: string;
        currency: string;
        timezone: string;
        configuredStatus: "ACTIVE" | "PAUSED" | "REMOVED";
        deliveryStatus:
          | "ACTIVE"
          | "PAUSED"
          | "REMOVED"
          | "NOT_DELIVERING"
          | "NOT_APPROVED";
        createdDate: string;
        modifiedDate: string;
      };
      campaign: {
        id: number;
        name: string;
        campaignObjective:
          | "VISIT_MY_WEBSITE"
          | "APP_INSTALL"
          | "APP_ENGAGEMENT"
          | "WEBSITE_CONVERSION"
          | "DYNAMIC_PRODUCT"
          | "GAIN_FRIENDS"
          | "REACH_AND_FREQUENCY"
          | "VIDEO_VIEW";
        spendingLimitType: "NONE" | "MONTHLY" | "LIFETIME";
        spendingLimitMicro: number;
        startDate: string;
        endDate: string;
        activeCbo: boolean;
        configuredStatus: "ACTIVE" | "PAUSED" | "REMOVED";
        deliveryStatus:
          | "ACTIVE"
          | "PAUSED"
          | "REMOVED"
          | "NOT_DELIVERING"
          | "NOT_APPROVED";
        createdDate: string;
        modifiedDate: string;
      };
      adgroup: {
        id: number;
        campaignId: number;
        name: string;
        dailyBudgetMicro: number;
        bidAmountMicro: number;
        bidType: "CPC" | "CPF" | "CPM";
        configuredStatus: "ACTIVE" | "PAUSED" | "REMOVED";
        deliveryStatus:
          | "ACTIVE"
          | "PAUSED"
          | "REMOVED"
          | "NOT_DELIVERING"
          | "NOT_APPROVED";
        createdDate: string;
        modifiedDate: string;
      };
      statistics: {
        currency: string;
        cost: number;
        imp: number;
        viewableImp: number;
        click: number;
        cv: number;
        videoCompletions: number;
        videoStart: number;
        videoView3s: number;
        videoView25r: number;
        videoView50r: number;
        videoView75r: number;
        videoView95r: number;
        reach: number;
        ctr: number;
        cvr: number;
        cpc: number;
        cpm: number;
        cpa: number;
        costPerVideoView3s: number;
        costPerVideoCompletion: number;
        install: number;
        vtInstall: number;
        totalInstall: number;
        skadnInstall: number;
        open: number;
        viewHome: number;
        viewCategory: number;
        viewItem: number;
        search: number;
        addToCart: number;
        purchase: number;
        levelAchieved: number;
        tutorialComplete: number;
        installCtr: number;
        skadnInstallCtr: number;
        installCpa: number;
        totalInstallCpa: number;
        skadnInstallCpa: number;
        openCtr: number;
        openCpa: number;
        viewHomeCtr: number;
        viewHomeCpa: number;
        viewCategoryCtr: number;
        viewCategoryCpa: number;
        viewItemCtr: number;
        viewItemCpa: number;
        searchCtr: number;
        searchCpa: number;
        addToCartCtr: number;
        addToCartCpa: number;
        purchaseCtr: number;
        purchaseCpa: number;
        levelAchievedCtr: number;
        levelAchievedCpa: number;
        tutorialCompleteCtr: number;
        tutorialCompleteCpa: number;
      };
    }
  ];
  timeRange: { since: string; until: string };
};
