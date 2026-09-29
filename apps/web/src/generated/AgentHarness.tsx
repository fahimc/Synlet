import { Badge, Button, Card, Divider, Heading, Icon, Input, Page, Row, Section, Spacer, Stack, Text } from "@/components/ui"

export function AgentHarness({ data, onAction }: { data: any; onAction: (name: string) => void }) {
  return (
    <Page>
      <Row gap="none" variant="shell">
        <Section variant="sidebar">
          <Row gap="sm" variant="brand">
            <Badge tone="dark">S</Badge>
            <Heading level={2}>Synlet</Heading>
          </Row>
          <Button variant="secondary" onClick={() => onAction("newChat")}>New task</Button>
          <Divider />
          <Text tone="muted">Recent runs</Text>
          {data.view.history.map((item, i) => (
            <Button key={i} variant="ghost" onClick={() => onAction(item.action)}>{item.title}</Button>
          ))}
          <Spacer />
          <Divider />
          <Text tone="muted">Local agent harness</Text>
          {data.view.capabilities.map((item, i) => (
            <Row key={i} gap="sm" variant="capability">
              <Badge tone={item.tone}>{item.label}</Badge>
              <Text>{item.value}</Text>
            </Row>
          ))}
        </Section>
        <Section variant="conversation">
          <Row gap="sm" variant="topbar">
            <Heading level={2}>Synlet Codex</Heading>
            <Badge tone="success">{data.view.runtime}</Badge>
            <Spacer />
            <Text tone="muted">{data.view.model}</Text>
          </Row>
          <Divider />
          <Stack gap="lg" variant="messages">
            {data.view.empty && (
              <Section variant="welcome">
                <Heading level={1}>What should we build?</Heading>
                <Text tone="muted">Use the local model, skills, MCP tools, web browser, files, and terminal from one inspectable flow.</Text>
              </Section>
            )}
            {data.view.messages.map((item, i) => (
              <Card key={i} variant={item.role}>
                <Badge tone={item.tone}>{item.label}</Badge>
                <Text>{item.content}</Text>
                {item.hasTrace && (
                  <Section variant="trace">
                    <Row gap="sm" variant="traceHeader">
                      <Heading level={3}>Task flow</Heading>
                      <Badge tone={item.traceTone}>{item.traceStatus}</Badge>
                      <Spacer />
                      <Text tone="muted">{item.traceSummary}</Text>
                    </Row>
                    {item.trace.map((item, i) => (
                      <Row key={i} gap="sm" variant="traceNode">
                        <Icon name={item.icon} />
                        <Stack gap="none">
                          <Text>{item.label}</Text>
                          {item.hasModel && (
                            <Text tone="muted">{item.model}</Text>
                          )}
                          <Text tone="muted">{item.detail}</Text>
                        </Stack>
                        <Spacer />
                        <Badge tone={item.tone}>{item.status}</Badge>
                      </Row>
                    ))}
                  </Section>
                )}
              </Card>
            ))}
            {data.view.running && (
              <Button variant="secondary" onClick={() => onAction("cancel")}>Stop run</Button>
            )}
          </Stack>
          <Section variant="composer">
            <Input placeholder="Message Synlet…" value={data.view.draft} />
            <Row gap="sm">
              <Badge tone="muted">Full computer</Badge>
              <Badge tone="muted">Web</Badge>
              <Badge tone="muted">MCP</Badge>
              <Badge tone="muted">Skills</Badge>
              <Spacer />
              <Button variant="primary" onClick={() => onAction("send")}>Send</Button>
            </Row>
            <Text tone="muted">Commands run locally. Destructive effects remain visible in the task flow.</Text>
          </Section>
        </Section>
      </Row>
    </Page>
  )
}
