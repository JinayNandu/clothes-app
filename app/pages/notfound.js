// ============================================================================
// Not found. Specific copy, like every other empty state on this site — "404"
// with nothing after it is placeholder text that shipped.
// ============================================================================

import * as router from '../router.js';
import { emptyState } from '../ui.js';
import { seal } from '../brand.js';

router.registerScreen('notfound', async (host) => {
  host.innerHTML = emptyState(seal(64),
    'There is nothing at that address.',
    'The link may be mistyped, or it may point at a piece we have retired. '
    + 'The catalogue is not long — everything we sell is on one page.',
    'Shop all', '#/shop');
});
