import { Button } from '../ui/controls';
import { Page, PageHead } from '../ui/layout';

export function NotFound() {
  return (
    <Page>
      <PageHead title="Wrong door" lede="Nothing lives at this address. If someone sent you a link, check it was copied in full." />
      <Button to="/" variant="primary">
        Back to the hub
      </Button>
    </Page>
  );
}
