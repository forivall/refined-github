import React from 'dom-chef';

import * as pageDetect from 'github-url-detection';
import ExternalIcon from 'octicons-plain-react/TabExternal';
import XIcon from 'octicons-plain-react/X';

import {CachedFunction} from 'webext-storage-cache';

import features from '../feature-manager.js';
import api from '../github-helpers/api.js';
import observe from '../helpers/selector-observer.js';
import GetReviewThreads from './open-file-local.gql';

const storagePrefix = 'rgh-open-file-local';

function getCwd(): string {
	const nameWithOwner = pageDetect.utils.getRepositoryInfo()?.nameWithOwner;
	const storageKey = nameWithOwner
		? `${storagePrefix}.${JSON.stringify(nameWithOwner)}`
		: storagePrefix;

	return localStorage.getItem(storageKey) || '';
}

function setCwd(value: string): void {
	const nameWithOwner = pageDetect.utils.getRepositoryInfo()?.nameWithOwner;
	const storageKey = nameWithOwner
		? `${storagePrefix}.${JSON.stringify(nameWithOwner)}`
		: storagePrefix;

	return localStorage.setItem(storageKey, value);
}

function updateCwd(event: React.ChangeEvent<HTMLInputElement>): void {
	setCwd(event.target.value);
}
type ReviewThread = {
	line: number;
	path: string;
	id: string;
	comments: {
		nodes: {id: string; url: string}[];
	};
	subjectType: string;
};

const reviewThreads = new CachedFunction('review-threads', {
	async updater(pr: number): Promise<ReviewThread[]> {
		const variables: {pr: number; endCursor?: string} = {pr};

		let data = await api.v4(GetReviewThreads, {variables});
		let reviewThreads = data?.repository.pullRequest.reviewThreads.nodes ?? [];

		while (data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage) {
			variables.endCursor
				= data.repository.pullRequest.reviewThreads.pageInfo.endCursor;
			// eslint-disable-next-line no-await-in-loop
			data = await api.v4(GetReviewThreads, {variables});
			reviewThreads = [
				...reviewThreads,
				...data.repository.pullRequest.reviewThreads.nodes,
			];
		}

		return reviewThreads;
	},
});

function init(signal: AbortSignal): void {
	observe(
		[
			// '#partial-discussion-header .gh-header-meta',
			'#partial-discussion-header .gh-header-sticky',
			'#files_bucket .pr-review-tools',
		],
		addWidget,
		{signal},
	);

	async function addWidget(anchor: HTMLElement): Promise<void> {
		if (anchor.querySelector('rgh-open-file-local')) {
			return;
		}

		const positionClass = anchor.classList.contains('gh-header-sticky')
			? 'ml-2 float-right'
			: anchor.classList.contains('pr-review-tools')
				? 'mr-2 diffbar-item'
				: '';

		// It may be zero on the sticky header, but `clean-conversation-headers` doesn't apply there
		const alignment = 'right-0'; // 'left-0';

		(child => anchor.insertBefore(child, anchor.firstChild))(
			<details
				className={`details-reset details-overlay d-inline-block ${positionClass}`}
				id="rgh-open-file-local-select-menu"
			>
				<summary>
					<ExternalIcon className="color-fg-muted" />
					<div className="dropdown-caret ml-1" />
				</summary>
				<details-menu className={`SelectMenu ${alignment}`}>
					<div className="SelectMenu-modal">
						<div className="SelectMenu-header">
							<h3 className="SelectMenu-title color-fg-default">
								Local checkout location
							</h3>
							<button
								className="SelectMenu-closeButton"
								type="button"
								data-toggle-for="rgh-open-file-local-select-menu"
							>
								<XIcon />
							</button>
						</div>
						<div className="SelectMenu-list">
							<input
								type="text"
								className="form-control input-block pl-5 js-filterable-field"
								placeholder="/path/to/local/repo"
								value={getCwd()}
								onChange={updateCwd}
								onBlur={updateAnchors}
							/>
						</div>
					</div>
				</details-menu>
			</details>,
		);
	}

	const anchors: {
		anchor: HTMLAnchorElement;
		loc: string;
		hash?: string;
		lineNumber?: string;
	}[] = [];
	const pathBase = pageDetect.utils.getCleanPathname();
	const prNumber = pathBase.split('/')[3];
	let cwd = getCwd();
	if (cwd) {
		createAnchors();
	}

	let currenthash = '';
	function updateAnchors(): void {
		cwd = getCwd();
		if (!cwd) {
			return;
		}
		if (anchors.length === 0) {
			createAnchors();
			return;
		}
		for (let {anchor, loc, hash, lineNumber} of anchors) {
			let href = `vscode://file${cwd}/${loc}`;
			if (hash && currenthash.startsWith(hash)) {
				const hashLineNumber = currenthash.slice(hash.length + 1).split('-')[0];
				if (hashLineNumber) {
					lineNumber = hashLineNumber;
				}
			}
			if (lineNumber) {
				href += `:${lineNumber}`;
			}
			anchor.href = href;
		}
	}
	function createAnchor(
		loc: string,
		lineNumber: string | undefined,
		hash?: string | undefined,
	): HTMLAnchorElement {
		let href = `vscode://file${cwd}/${loc}`;
		if (lineNumber) {
			href += `:${lineNumber}`;
		}
		const anchor: HTMLAnchorElement = (
			<a href={href} className="Link--onHover color-fg-muted ml-2 mr-2">
				open
			</a>
		) as HTMLElement as HTMLAnchorElement;
		anchors.push({anchor, hash, loc, lineNumber});
		return anchor;
	}
	function createFileAnchor(element: HTMLElement): void {
		const loc = element.getAttribute('value');
		if (!loc) {
			return;
		}
		const linkanchor: (Element & Partial<Pick<HTMLAnchorElement, 'href'>>) |
			undefined = element.previousElementSibling ?? undefined;
		const lineNumberElement: HTMLElement | undefined = element
			.closest('.js-file')
			?.querySelector('.blob-num-addition[data-line-number]') ?? undefined;
		const lineNumber = lineNumberElement?.dataset.lineNumber;
		const hash = linkanchor?.getAttribute('href') ?? undefined;
		const anchor = createAnchor(loc, lineNumber, hash);
		element.after(anchor);
	}

	function createAnchors(): void {
		if (pageDetect.isPRConversation()) {
			const pendingAttachments = new WeakSet<HTMLElement>();
			const aSelector = `a[href^=${JSON.stringify(
				`/${pathBase}/files`,
			)}]`;
			const selector = `.js-comment-container ${aSelector}`;
			const createCommentAnchor = async (element: HTMLElement): Promise<void> => {
				const summary = element.closest('summary');
				const commentLinks: NodeListOf<HTMLAnchorElement> | undefined
					= summary?.parentElement?.querySelectorAll('a[href^="#discussion"]');
				const commentHrefs = new Set(
					[...(commentLinks ?? [])].map(anchor => anchor.href),
				);
				if (commentHrefs.size === 0) {
					pendingAttachments.add(element);
					return;
				}
				pendingAttachments.delete(element);
				const reviewThreadsResult = await reviewThreads.get(Number.parseInt(prNumber, 10));
				const loc = reviewThreadsResult.find(thread => thread.comments.nodes.some(it => commentHrefs.has(it.url)),
				)?.path || element.textContent?.trim();

				const lineNumberElement: HTMLElement | undefined = summary?.nextElementSibling?.querySelector(
					'.blob-num-addition[data-line-number]',
				) ?? undefined;
				const lineNumber = lineNumberElement?.dataset.lineNumber;
				const anchor = createAnchor(loc, lineNumber);
				element.parentElement?.classList.remove('mr-3');
				element.after(anchor);
			};
			observe(selector, createCommentAnchor, {signal});
			const resolvePendingAttachments = async (element: HTMLElement): Promise<void> => {
				const pendingCommentContainer = element.closest('.js-comment-container');
				const pendingAnchor = pendingCommentContainer?.querySelector(aSelector);
				if (pendingAnchor && pendingAttachments.has(pendingAnchor)) {
					await createCommentAnchor(pendingAnchor);
				}
			};
			observe('a[href^="#discussion"]', resolvePendingAttachments, {signal});
		}

		observe('.file-info clipboard-copy', createFileAnchor, {signal});
	}

	if (globalThis.navigation) {
		globalThis.navigation.onnavigate = (event_: NavigateEvent) => {
			const u = new URL(event_.destination.url);
			if (u.hash) {
				currenthash = u.hash;
				updateAnchors();
			}
		};
	}
}

void features.add(import.meta.url, {
	include: [
		pageDetect.isPR, // Find the one you need on https://refined-github.github.io/github-url-detection/
	],
	init,
});
