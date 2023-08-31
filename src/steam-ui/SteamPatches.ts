import { Mountable } from '../app/system'
import logger from '../utils'
import { Cache } from '../app/cache'

export { SteamPatches }

class SteamPatches implements Mountable {
    private cachedApps: Cache<Map<string, number>>

    constructor(cachedApps: Cache<Map<string, number>>) {
        this.cachedApps = cachedApps
    }

    public mount() {
        this.ReplaceAppInfoStoreOnAppOverviewChange()
        this.ReplaceAppStoreMapAppsSet()
        this.cachedApps.subscribe((data) => {
            let changedApps = []
            for (let [appId, time] of data) {
                let appOverview = appStore.GetAppOverviewByAppID(parseInt(appId))
                if (appOverview?.app_type == 1073741824) {
                    appOverview.minutes_playtime_forever = (time / 60.0).toFixed(1)
                    changedApps.push(appOverview)
                }
            }
            appInfoStore.OnAppOverviewChange(changedApps)
            appStore.m_mapApps.set(
                changedApps.map((app) => app.appid),
                changedApps
            )
        })
    }

    public unMount() {
        this.RestoreOnAppOverviewChange()
        this.RestoreAppStoreMapAppsSet()
    }

    // here we patch AppInfoStore OnAppOverviewChange method so we can prepare changed app overviews for the next part of the patch (AppOverview.InitFromProto)
    private ReplaceAppInfoStoreOnAppOverviewChange() {
        this.RestoreOnAppOverviewChange()
        if (appInfoStore && !appInfoStore.OriginalOnAppOverviewChange) {
            logger.debug(`ReplaceAppInfoStoreOnAppOverviewChange`)
            appInfoStore.OriginalOnAppOverviewChange = appInfoStore.OnAppOverviewChange
            let instance = this
            appInfoStore.OnAppOverviewChange = function (apps: Array<any>) {
                let appIds = apps
                    .filter((_: any) => typeof _.appid() === 'number')
                    .map((_: any) => _.appid() as number)
                instance.appInfoStoreOnAppOverviewChange(appIds)
                logger.debug(`AppInfoStore.OnAppOverviewChange: calling original`)
                this.OriginalOnAppOverviewChange(apps)
            }
        }
    }

    private RestoreOnAppOverviewChange() {
        if (appInfoStore && appInfoStore.OriginalOnAppOverviewChange) {
            //logger.trace(`RestoreOnAppOverviewChange`);
            appInfoStore.OnAppOverviewChange = appInfoStore.OriginalOnAppOverviewChange
            appInfoStore.OriginalOnAppOverviewChange = null
        }
    }

    // here we patch AppStore m_mapApps Map set method so we can overwrite playtime before setting AppOverview
    private ReplaceAppStoreMapAppsSet() {
        this.RestoreAppStoreMapAppsSet()
        if (appStore.m_mapApps && !appStore.m_mapApps.originalSet) {
            //logger.trace(`ReplaceAppStoreMapAppsSet`);
            appStore.m_mapApps.originalSet = appStore.m_mapApps.set
            let instance = this
            let appStoreInstance = appStore
            appStore.m_mapApps.set = function (appId: number, appOverview: any): any {
                instance.appStoreMapAppsSet(appId, appOverview)
                appStoreInstance.m_mapApps.originalSet(appId, appOverview)
            }
        }
    }

    private RestoreAppStoreMapAppsSet() {
        if (appStore.m_mapApps && appStore.m_mapApps.originalSet) {
            //logger.trace(`RestoreAppStoreMapAppsSet`);
            appStore.m_mapApps.set = appStore.m_mapApps.originalSet
            appStore.m_mapApps.originalSet = null
        }
    }

    // here we patch AppOverview InitFromProto method so we can overwrite playtime after original method
    private appInfoStoreOnAppOverviewChange(appIds: Array<number> | null) {
        logger.debug(`AppInfoStore.OnAppOverviewChange (${appIds ? '[]' : 'null'})`)
        if (appIds) {
            appIds.forEach((appId) => {
                let appOverview = appStore.GetAppOverviewByAppID(appId)
                if (appOverview?.app_type == 1073741824 && this.cachedApps.isReady()) {
                    const time = this.cachedApps.get()!.get(`${appId}`) || 0
                    appOverview.OriginalInitFromProto = appOverview.InitFromProto
                    appOverview.InitFromProto = function (proto: any) {
                        appOverview.OriginalInitFromProto(proto)
                        logger.info(
                            `AppOverview.InitFromProto: Setting playtime for ${appOverview.display_name} (${appId}) to ${time}`
                        )
                        appOverview.minutes_playtime_forever = (time / 60.0).toFixed(1)
                        appOverview.InitFromProto = appOverview.OriginalInitFromProto
                    }
                }
            })
        }
    }

    // here we set playtime to appOverview before the appOverview is added to AppStore_m_mapApps map
    private appStoreMapAppsSet(appId: number, appOverview: any) {
        //logger.trace(`AppStore.m_mapApps.set (${appId})`);
        if (appId && appOverview && this.cachedApps.isReady()) {
            const time = this.cachedApps.get()!.get(`${appId}`) || 0
            if (time && appOverview?.app_type == 1073741824) {
                logger.info(
                    `AppStore.m_mapApps.set: Setting playtime for ${appOverview.display_name} (${appId}) to ${time}`
                )
                appOverview.minutes_playtime_forever = (time / 60.0).toFixed(1)
            }
        }
    }
}