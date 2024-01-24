import { PermissionAction } from '@supabase/shared-types/out/constants'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useMemo, useState } from 'react'

import { useParams } from 'common'
import { useTheme } from 'next-themes'
import { useProjectContext } from 'components/layouts/ProjectLayout/ProjectContext'
import { setProjectStatus } from 'data/projects/projects-query'
import { useProjectAddonRemoveMutation } from 'data/subscriptions/project-addon-remove-mutation'
import { useProjectAddonUpdateMutation } from 'data/subscriptions/project-addon-update-mutation'
import { useProjectAddonsQuery } from 'data/subscriptions/project-addons-query'
import { useCheckPermissions, useSelectedOrganization, useStore } from 'hooks'
import { getCloudProviderArchitecture } from 'lib/cloudprovider-utils'
import { BASE_PATH, PROJECT_STATUS } from 'lib/constants'
import Telemetry from 'lib/telemetry'
import { useSubscriptionPageStateSnapshot } from 'state/subscription-page'
import {
  Alert,
  AlertDescription_Shadcn_,
  Alert_Shadcn_,
  Badge,
  Button,
  IconAlertTriangle,
  IconExternalLink,
  IconInfo,
  Modal,
  Radio,
  SidePanel,
} from 'ui'

import * as Tooltip from '@radix-ui/react-tooltip'
import { useOrgSubscriptionQuery } from 'data/subscriptions/org-subscription-query'
import { AddonVariantId } from 'data/subscriptions/types'

const ComputeInstanceSidePanel = () => {
  const queryClient = useQueryClient()
  const { ui } = useStore()
  const router = useRouter()
  const { ref: projectRef } = useParams()
  const { resolvedTheme } = useTheme()
  const { project: selectedProject } = useProjectContext()
  const organization = useSelectedOrganization()

  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<'off' | 'optimized'>('off')

  const canUpdateCompute = useCheckPermissions(
    PermissionAction.BILLING_WRITE,
    'stripe.subscriptions'
  )

  const snap = useSubscriptionPageStateSnapshot()
  const visible = snap.panelKey === 'computeInstance'
  const onClose = () => {
    const { panel, ...queryWithoutPanel } = router.query
    router.push({ pathname: router.pathname, query: queryWithoutPanel }, undefined, {
      shallow: true,
    })
    snap.setPanelKey(undefined)
  }

  const { data: addons, isLoading } = useProjectAddonsQuery({ projectRef })
  const { data: subscription } = useOrgSubscriptionQuery({ orgSlug: organization?.slug })
  const { mutate: updateAddon, isLoading: isUpdating } = useProjectAddonUpdateMutation({
    onSuccess: () => {
      ui.setNotification({
        duration: 8000,
        category: 'success',
        message: `Successfully updated compute instance to ${selectedCompute?.name}. Your project is currently being restarted to update its instance`,
      })
      setProjectStatus(queryClient, projectRef!, PROJECT_STATUS.RESTORING)
      onClose()
      router.push(`/project/${projectRef}`)
    },
    onError: (error) => {
      ui.setNotification({
        error,
        category: 'error',
        message: `Unable to update compute instance: ${error.message}`,
      })
    },
  })
  const { mutate: removeAddon, isLoading: isRemoving } = useProjectAddonRemoveMutation({
    onSuccess: () => {
      ui.setNotification({
        duration: 8000,
        category: 'success',
        message: `Successfully updated compute instance. Your project is currently being restarted to update its instance`,
      })
      setProjectStatus(queryClient, projectRef!, PROJECT_STATUS.RESTORING)
      onClose()
      router.push(`/project/${projectRef}`)
    },
    onError: (error) => {
      ui.setNotification({
        error,
        category: 'error',
        message: `Unable to update compute instance: ${error.message}`,
      })
    },
  })

  const defaultInstanceSize = useMemo(() => {
    if (!addons) return ''

    const microAvailableAsAddon = addons?.available_addons.some((addon) =>
      addon.variants.some((variant) => variant.identifier === 'ci_micro')
    )

    return microAvailableAsAddon ? 'ci_nano' : 'ci_micro'
  }, [addons])

  const [selectedOption, setSelectedOption] = useState<string>('')

  const COMPUTE_CATEGORY_OPTIONS: {
    id: 'off' | 'optimized'
    name: string
    imageUrl: string
    imageUrlLight: string
  }[] = useMemo(() => {
    if (!defaultInstanceSize) return []

    return [
      {
        id: 'off',
        // If micro is available as add-on, the default compute will be nano instead of micro
        name: defaultInstanceSize === 'ci_nano' ? 'Nano Compute' : 'Micro Compute',
        imageUrl: `${BASE_PATH}/img/optimized-compute-off.svg`,
        imageUrlLight: `${BASE_PATH}/img/optimized-compute-off--light.svg`,
      },
      {
        id: 'optimized',
        name: 'Optimized Compute',
        imageUrl: `${BASE_PATH}/img/optimized-compute-on.svg`,
        imageUrlLight: `${BASE_PATH}/img/optimized-compute-on--light.svg`,
      },
    ]
  }, [defaultInstanceSize])

  const isSubmitting = isUpdating || isRemoving

  const projectId = selectedProject?.id
  const cpuArchitecture = getCloudProviderArchitecture(selectedProject?.cloud_provider)
  const selectedAddons = addons?.selected_addons ?? []
  const availableAddons = addons?.available_addons ?? []

  const isFreePlan = subscription?.plan?.id === 'free'
  const subscriptionCompute = selectedAddons.find((addon) => addon.type === 'compute_instance')
  const pitrAddon = selectedAddons.find((addon) => addon.type === 'pitr')
  const availableOptions =
    availableAddons.find((addon) => addon.type === 'compute_instance')?.variants ?? []
  const selectedCompute = availableOptions.find((option) => option.identifier === selectedOption)
  const hasChanges =
    selectedOption !== (subscriptionCompute?.variant.identifier ?? defaultInstanceSize)

  const blockDowngradeDueToPitr =
    pitrAddon !== undefined && ['ci_micro', 'ci_nano'].includes(selectedOption) && hasChanges

  useEffect(() => {
    if (visible) {
      if (subscriptionCompute !== undefined) {
        setSelectedCategory('optimized')
        setSelectedOption(subscriptionCompute.variant.identifier)
      } else {
        setSelectedCategory('off')
        setSelectedOption(defaultInstanceSize)
      }
      Telemetry.sendActivity(
        {
          activity: 'Side Panel Viewed',
          source: 'Dashboard',
          data: {
            title: 'Change project compute size',
            section: 'Add ons',
          },
          projectRef,
        },
        router
      )
    }
  }, [visible, isLoading])

  const onConfirmUpdateComputeInstance = async () => {
    if (!projectRef) return console.error('Project ref is required')
    if (!projectId) return console.error('Project ID is required')

    if (selectedOption === defaultInstanceSize && subscriptionCompute !== undefined) {
      removeAddon({ projectRef, variant: subscriptionCompute.variant.identifier })
    } else {
      updateAddon({
        projectRef,
        type: 'compute_instance',
        variant: selectedOption as AddonVariantId,
      })
    }
  }

  return (
    <>
      <SidePanel
        size="xxlarge"
        visible={visible}
        onCancel={onClose}
        onConfirm={() => setShowConfirmationModal(true)}
        loading={isLoading}
        disabled={
          isFreePlan || isLoading || !hasChanges || blockDowngradeDueToPitr || !canUpdateCompute
        }
        tooltip={
          isFreePlan
            ? 'Unable to update compute instance on a free plan'
            : !canUpdateCompute
            ? 'You do not have permission to update compute instance'
            : undefined
        }
        header={
          <div className="flex items-center justify-between">
            <h4>Change project compute size</h4>
            <Button asChild type="default" icon={<IconExternalLink strokeWidth={1.5} />}>
              <Link
                href="https://supabase.com/docs/guides/platform/compute-add-ons"
                target="_blank"
                rel="noreferrer"
              >
                About compute sizes
              </Link>
            </Button>
          </div>
        }
      >
        <SidePanel.Content>
          <div className="py-6 space-y-4">
            <p className="text-sm">
              For the database, compute size refers to the amount of CPU and memory allocated to the
              database instance.
            </p>

            <div className="!mt-8 pb-4">
              <div className="flex gap-3">
                {COMPUTE_CATEGORY_OPTIONS.map((option) => {
                  const isSelected = selectedCategory === option.id
                  return (
                    <div
                      key={option.id}
                      className={clsx('col-span-3 group space-y-1', isFreePlan && 'opacity-75')}
                      onClick={() => {
                        setSelectedCategory(option.id)
                        if (option.id === 'off') setSelectedOption(defaultInstanceSize)
                        Telemetry.sendActivity(
                          {
                            activity: 'Option Selected',
                            source: 'Dashboard',
                            data: {
                              title: 'Change project compute size',
                              section: 'Add ons',
                              option: option.name,
                            },
                            projectRef,
                          },
                          router
                        )
                      }}
                    >
                      <img
                        alt="Compute Instance"
                        className={clsx(
                          'relative rounded-xl transition border bg-no-repeat bg-center bg-cover cursor-pointer w-[160px] h-[96px]',
                          isSelected
                            ? 'border-foreground'
                            : 'border-foreground-muted opacity-50 group-hover:border-foreground-lighter group-hover:opacity-100'
                        )}
                        width={160}
                        height={96}
                        src={
                          resolvedTheme?.includes('dark') ? option.imageUrl : option.imageUrlLight
                        }
                      />

                      <p
                        className={clsx(
                          'text-sm transition',
                          isSelected ? 'text-foreground' : 'text-foreground-light'
                        )}
                      >
                        {option.name}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>

            {selectedCategory === 'optimized' && (
              <div className="pb-4">
                {isFreePlan && (
                  <Alert
                    withIcon
                    className="mb-4"
                    variant="info"
                    title="Changing your compute size is only available on the Pro plan"
                    actions={
                      <Button asChild type="default">
                        <Link href={`/org/${organization?.slug}/billing?panel=subscriptionPlan`}>
                          View available plans
                        </Link>
                      </Button>
                    }
                  >
                    Upgrade your plan to change the compute size of your project
                  </Alert>
                )}
                <Radio.Group
                  type="large-cards"
                  size="tiny"
                  id="compute-instance"
                  label={<p className="text-sm">Choose the compute size you want to use</p>}
                  onChange={(event: any) => setSelectedOption(event.target.value)}
                >
                  {availableOptions.map((option) => (
                    <Radio
                      className="col-span-3 !p-0"
                      disabled={isFreePlan}
                      name="compute-instance"
                      key={option.identifier}
                      checked={selectedOption === option.identifier}
                      label={option.name}
                      value={option.identifier}
                    >
                      <div className="w-full group">
                        <div className="border-b border-default px-4 py-2">
                          <p className="text-sm flex justify-between">
                            {option.name}{' '}
                            {subscriptionCompute?.variant.identifier === option.identifier && (
                              <Badge>Current</Badge>
                            )}
                          </p>
                        </div>
                        <div className="px-4 py-2">
                          <p className="text-foreground-light">
                            {option.meta?.memory_gb ?? 0} GB memory
                          </p>
                          <p className="text-foreground-light">
                            {option.meta?.cpu_cores ?? 0}-core {cpuArchitecture} CPU (
                            {option.meta?.cpu_dedicated ? 'Dedicated' : 'Shared'})
                          </p>
                          <div className="flex justify-between items-center mt-2">
                            <div className="flex items-center space-x-1">
                              <span className="text-foreground text-sm">
                                ${option.price.toLocaleString()}
                              </span>
                              <span className="text-foreground-light translate-y-[1px]">
                                {' '}
                                / {option.price_interval === 'monthly' ? 'month' : 'hour'}
                              </span>
                            </div>
                            {option.price_interval === 'hourly' && (
                              <Tooltip.Root delayDuration={0}>
                                <Tooltip.Trigger>
                                  <div className="flex items-center">
                                    <IconInfo
                                      size={14}
                                      strokeWidth={2}
                                      className="hover:text-foreground-light"
                                    />
                                  </div>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content side="bottom">
                                    <Tooltip.Arrow className="radix-tooltip-arrow" />
                                    <div
                                      className={[
                                        'rounded bg-alternative py-1 px-2 leading-none shadow',
                                        'border border-background',
                                      ].join(' ')}
                                    >
                                      <div className="flex items-center space-x-1">
                                        <p className="text-foreground text-sm">
                                          ${Number(option.price * 672).toFixed(0)} - $
                                          {Number(option.price * 744).toFixed(0)} per month
                                        </p>
                                      </div>
                                    </div>
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>
                            )}
                          </div>
                        </div>
                      </div>
                    </Radio>
                  ))}
                </Radio.Group>
              </div>
            )}

            {selectedCategory === 'off' && (
              <p className="text-sm text-foreground-light">
                Your database will use the standard{' '}
                {defaultInstanceSize === 'ci_nano' ? 'Nano' : 'Micro'} size instance of 2-core{' '}
                {cpuArchitecture} CPU (Shared) with{' '}
                {defaultInstanceSize === 'ci_nano' ? '0.5' : '1'}GB of memory.
              </p>
            )}

            {hasChanges && selectedCategory !== 'off' && (
              <p className="text-sm text-foreground-light">
                There are no immediate charges when changing compute. Compute Hours are a
                usage-based item and you're billed at the end of your billing cycle based on your
                compute usage. Read more about{' '}
                <Link
                  href="https://supabase.com/docs/guides/platform/org-based-billing#usage-based-billing-for-compute"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Compute Billing
                </Link>
                .
              </p>
            )}

            {hasChanges && !blockDowngradeDueToPitr && (
              <Alert
                withIcon
                variant="info"
                title="Your project will need to be restarted when changing it's compute size"
              >
                Your project will be unavailable for up to 2 minutes while the changes take place.
              </Alert>
            )}

            {blockDowngradeDueToPitr && (
              <Alert
                withIcon
                variant="info"
                className="mb-4"
                title="Disable PITR before downgrading"
                actions={
                  <Button type="default" onClick={() => snap.setPanelKey('pitr')}>
                    Change PITR
                  </Button>
                }
              >
                <p>
                  You currently have PITR enabled. The minimum compute instance size for using PITR
                  is the Small Compute.
                </p>
                <p>
                  You need to disable PITR before downgrading Compute as it requires at least a
                  Small compute instance.
                </p>
              </Alert>
            )}

            {hasChanges &&
              subscription?.billing_via_partner &&
              subscription.scheduled_plan_change?.target_plan !== undefined && (
                <Alert_Shadcn_ variant={'warning'} className="mb-2">
                  <IconAlertTriangle className="h-4 w-4" />
                  <AlertDescription_Shadcn_>
                    You have a scheduled subscription change that will be canceled if you change
                    your Optimized Compute add on.
                  </AlertDescription_Shadcn_>
                </Alert_Shadcn_>
              )}
          </div>
        </SidePanel.Content>
      </SidePanel>

      <Modal
        size="medium"
        alignFooter="right"
        visible={showConfirmationModal}
        loading={isSubmitting}
        onCancel={() => setShowConfirmationModal(false)}
        onConfirm={() => onConfirmUpdateComputeInstance()}
        header="Confirm to upgrade compute instance now"
      >
        <Modal.Content>
          <div className="py-6">
            <Alert
              withIcon
              variant="warning"
              title="Your project will need to be restarted when changing it's compute size"
            >
              Your project will be unavailable for up to 2 minutes while the changes take place.
            </Alert>
          </div>
        </Modal.Content>
      </Modal>
    </>
  )
}

export default ComputeInstanceSidePanel
