
import * as pageDetect from 'github-url-detection';
import {$$, $optional, closestElementOptional, elementExists} from 'select-dom';

import features from '../feature-manager.js';
import {isEditable} from '../helpers/dom-utils.js';
import {viewedToggleSelector} from './batch-mark-files-as-viewed.js';

const isDisplayNone = (element: Element | undefined): boolean =>
	Boolean(element && getComputedStyle(element).display === 'none');

const isCommentGroupMinimized = (comment: HTMLElement): boolean =>
	elementExists('.minimized-comment:not(.d-none)', comment)
	|| Boolean(
		closestElementOptional([
			'.js-resolvable-thread-contents.d-none', // Regular comments
			'details.js-resolvable-timeline-thread-container:not([open])', // Review comments
		], comment),
	);

const isFileMinimized = (element: HTMLElement | undefined): boolean =>
	Boolean(
		element?.classList.contains('js-file')
		&& isDisplayNone($optional('.js-file-content', element)),
	);

function runShortcuts(event: KeyboardEvent): void {
	if (!'jkx'.includes(event.key) || isEditable(event.target)) {
		return;
	}

	event.preventDefault();
	const targetElement = $optional(':target') ?? $optional('[data-targeted=true]');

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
	const direction = event.key === 'j' ? 1 : -1;
	// Without `targetElement`, it will start from -1
	const currentIndex = items.indexOf(targetElement!);

	// Start at 0 if nothing is; clamp index
	const chosenItemIndex = Math.min(
		Math.max(0, currentIndex + direction),
		items.length - 1,
	);

	if (currentIndex !== chosenItemIndex) {
		// Make item a target without pushing to history
		location.replace('#' + items[chosenItemIndex].id);
	}
}

function init(signal: AbortSignal): void {
	document.body.addEventListener('keypress', runShortcuts, {signal});
}

void features.add(import.meta.url, {
	shortcuts: {
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
