import './keyboard-navigation.css';

import * as pageDetect from 'github-url-detection';
import {$$, $optional, closestElementOptional, elementExists} from 'select-dom';

import debounceFn from 'debounce-fn';

import features from '../feature-manager.js';
import {isEditable} from '../helpers/dom-utils.js';
import {viewedToggleSelector} from './batch-mark-files-as-viewed.js';

const isDisplayNone = (element: Element | undefined): boolean =>
	Boolean(element && getComputedStyle(element).display === 'none');

const isCommentGroupMinimized = (comment: HTMLElement): boolean =>
	elementExists('.minimized-comment:not(.d-none)', comment)
	// Review comments on Files tab
	|| isDisplayNone(
		comment.closest(['.js-file-content', '.js-file-level-comments-table'])
		?? undefined,
	)
	|| Boolean(
		closestElementOptional([
			'.js-resolvable-thread-contents.d-none', // Regular comments
			'details.js-resolvable-timeline-thread-container:not([open])', // Review comments on Conversation tab
		], comment),
	);

const isFileMinimized = (element: HTMLElement | undefined): boolean =>
	Boolean(
		(element?.classList.contains('js-file')
			&& isDisplayNone($optional('.js-file-content', element)))
		?? (element
			&& [...element.classList].some(className =>
				className.startsWith('Diff-module__diffTargetable--'),
			)
			&& $optional([
				'[class^="DiffFileHeader-module__collapsed--"]',
				'[class*=" DiffFileHeader-module__collapsed--"]',
			])),
	);

let lastViewChange: HTMLElement | undefined;
function trackLastViewChange(event: Event): void {
	const element
		= (event.target as EventTarget & Partial<Pick<Element, 'closest'>>).closest?.(
			['.js-targetable-element[id^="diff-"]', '[data-targeted]'],
		) ?? undefined;
	if (element) {
		lastViewChange = element;
	}
}

const scrollIntoViewDebounced = debounceFn(
	(element: HTMLElement) => {
		element.scrollIntoView();
	},
	{before: false, after: true, wait: 40},
);

function runShortcuts(event: KeyboardEvent): void {
	if (
		(!'jkx'.includes(event.key)
			&& !(event.ctrlKey && 'ud'.includes(event.key)))
		|| isEditable(event.target)
	) {
		return;
	}

	event.preventDefault();
	const targetElement = $optional(
			globalThis.location.hash || ':target:not([data-targeted=true])',
		)
		?? $optional('[data-targeted=true]')
		?? lastViewChange;

	if (event.key === 'x') {
		const viewedToggle = $optional(viewedToggleSelector, targetElement)
		if (viewedToggle) {
			const wasFileMinimized = isFileMinimized(targetElement);
			// The event handler is quite broad, there's no guarantee that the intention is to toggle "Viewed"
			viewedToggle.click();
			if (targetElement && wasFileMinimized && !targetElement.dataset.targeted) {
				location.replace('#' + targetElement.id);
			}
		}
		return;
	}

	const items = $$([
		'div[class*="targetable" i][id^="diff-"]', // Files in diffs
		'.js-minimizable-comment-group', // Comments (to be `.filter()`ed)
	])
		.filter(element =>
			element.classList.contains('js-minimizable-comment-group')
				? !isCommentGroupMinimized(element)
				: true,
		);

	// `j` goes to the next item, `k` goes back an item
	const direction = event.ctrlKey
		? event.key === 'd' ? 5 : -5
		: event.key === 'j' ? 1 : -1;
	// Without `targetElement`, it will start from -1
	let currentIndex = items.indexOf(targetElement!);
	if (currentIndex < 0) {
		const closestComment = targetElement?.querySelector(
			'.js-minimizable-comment-group',
		);
		if (closestComment) {
			currentIndex = items.indexOf(closestComment);
		}
	}

	// Start at 0 if nothing is; clamp index
	const chosenItemIndex = Math.min(
		Math.max(0, currentIndex + direction),
		items.length - 1,
	);

	if (currentIndex !== chosenItemIndex) {
		event.preventDefault();
		const chosenItem = items[chosenItemIndex];
		for (const item of items) {
			if (item.classList.contains('details-collapsed-target')) {
				item.classList.remove('details-collapsed-target');
			}

			if (item.classList.contains('not-target')) {
				item.classList.remove('not-target');
			}
		}

		if (chosenItem.classList.contains('js-details-container')) {
			if (isFileMinimized(chosenItem)) {
				// Change hash without focusing and expanding
				globalThis.history.replaceState(
					globalThis.history.state,
					'',
					'#' + chosenItem.id,
				);
				chosenItem.scrollIntoView();
				chosenItem.classList.add('details-collapsed-target');
				$optional(':target')?.classList.add('not-target');
			} else {
			  // Make item a target without pushing to history
				location.replace('#' + chosenItem.id);
			}
		} else if (chosenItem.role === 'region') {
			// Change hash to avoid github's horrible hashchange event handlers
			globalThis.history.replaceState(
				globalThis.history.state,
				'',
				'#' + chosenItem.id,
			);
			if (targetElement?.dataset.targeted === 'true') {
				targetElement.dataset.targeted = 'false';
			}

			chosenItem.dataset.targeted = 'true';
			scrollIntoViewDebounced(chosenItem);
		} else {
			((function_: (index: number, next: () => void) => void) => {
				const createNext = (index: number) => () => {
					function_(index, createNext(index + 1));
				};

				createNext(0)();
			})((index, next) => {
				if (index < 2) {
					window.addEventListener('scrollend', next, {
						once: true,
						passive: true,
					});
				} else {
					chosenItem.scrollIntoView({block: 'center'});
					if (index < 5) {
						requestAnimationFrame(next);
					}
				}
			});

			// Focus comment without pushing to history
			location.replace('#' + chosenItem.id);
		}
	}
}

function init(signal: AbortSignal): void {
	document.body.addEventListener('keypress', runShortcuts, {signal});
	document.body.addEventListener('change', trackLastViewChange);
	document.body.addEventListener('click', trackLastViewChange);
	document.body.addEventListener('focus', trackLastViewChange);
}

void features.add(import.meta.url, {
	shortcuts: {
		'ctrl u': 'Focus the comment/file 5 items above',
		'ctrl d': 'Focus the comment/file 5 items below',
		j: 'Focus the comment/file below',
		k: 'Focus the comment/file above',
		x: 'Mark the file as viewed/unviewed',
	},
	include: [pageDetect.hasComments],
	init,
});

/*

Test URLs:

https://github.com/refined-github/refined-github/pull/4030#discussion_r584184640
https://github.com/refined-github/refined-github/pull/8517/changes

*/
