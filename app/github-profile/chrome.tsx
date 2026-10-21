/* eslint-disable @next/next/no-img-element -- the viewer avatar is a remote image shown as-is */
import s from "./profile.module.css";
import { Icon } from "./octicon";
import type { IconName } from "./icon-paths";

export type ChromeTab = { icon: IconName; label: string; selected?: boolean; count?: string };

/** Signed-in app header plus the profile tab strip, which share one dark bar. */
export function Chrome({ viewer, tabs }: { viewer: { login: string; avatar?: string }; tabs: ReadonlyArray<ChromeTab> }) {
  return (
    <div className={s.chrome}>
      <header className={s.header}>
        <div className={s.hdrLeft}>
          <span className={s.iconBtn}>
            <Icon name="three-bars" />
          </span>
          <Icon name="mark-github" size={32} className={s.logo} />
          <span className={s.ctx}>{viewer.login}</span>
        </div>
        <div className={s.hdrRight}>
          <span className={s.search}>
            <Icon name="search" />
            <span className={s.searchText}>
              Type <span className={s.kbd}>/</span> to search
            </span>
          </span>
          <span className={s.split}>
            <span className={s.splitMain}>
              <Icon name="copilot" />
            </span>
            <span className={s.splitCaret}>
              <Icon name="triangle-down" />
            </span>
          </span>
          <span className={s.sep} />
          <span className={s.plusBtn}>
            <Icon name="plus" />
            <Icon name="triangle-down" />
          </span>
          <span className={s.iconBtn}>
            <Icon name="issue-opened" />
          </span>
          <span className={s.iconBtn}>
            <Icon name="git-pull-request" />
          </span>
          <span className={s.iconBtn}>
            <Icon name="repo" />
          </span>
          <span className={s.iconBtn}>
            <Icon name="inbox" />
            <span className={s.unread} />
          </span>
          {viewer.avatar
            ? <img className={s.viewer} src={viewer.avatar} alt="" width={32} height={32} referrerPolicy="no-referrer" />
            : <span className={s.viewer} />}
        </div>
      </header>
      <nav className={s.tabs} aria-label="User profile">
        {tabs.map((tab) => (
          <span key={tab.label} className={`${s.tab} ${tab.selected ? s.tabSelected : ""}`}>
            <Icon name={tab.icon} />
            {tab.label}
            {tab.count ? <span className={s.counter}>{tab.count}</span> : null}
          </span>
        ))}
      </nav>
    </div>
  );
}
