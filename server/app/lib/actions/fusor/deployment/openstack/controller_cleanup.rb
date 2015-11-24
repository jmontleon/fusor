#
# Copyright 2015 Red Hat, Inc.
#
# This software is licensed to you under the GNU General Public
# License as published by the Free Software Foundation; either version
# 2 of the License (GPLv2) or (at your option) any later version.
# There is NO WARRANTY for this software, express or implied,
# including the implied warranties of MERCHANTABILITY,
# NON-INFRINGEMENT, or FITNESS FOR A PARTICULAR PURPOSE. You should
# have received a copy of GPLv2 along with this software; if not, see
# http://www.gnu.org/licenses/old-licenses/gpl-2.0.txt.

require 'egon'
require 'fog'

module Actions
  module Fusor
    module Deployment
      module OpenStack
        # Ensure needed services are running on the Overcloud Controller
        class ControllerCleanup < Actions::Base
          def humanized_name
            _('Ensure needed services are running on the Overcloud Controller')
          end

          def plan(deployment)
            plan_self(deployment_id: deployment.id)
          end

          def run
            Rails.logger.debug '====== ControllerCleanup run method ======'
            deployment = ::Fusor::Deployment.find(input[:deployment_id])
            fetch_overcloud_ssh_key(deployment)
            fix_controller_services(deployment)
            Rails.logger.debug '=== Leaving ControllerCleanup run method ==='
          end

          def controller_cleanup_completed
            Rails.logger.info 'Controller Cleanup Completed'
          end

          def controller_cleanup_failed
            fail _('Controller Cleanup failed')
          end

          private

          def fetch_overcloud_ssh_key(deployment)
            client = Net::SSH.start(deployment.openstack_undercloud_ip_addr, 'root',
                                    :password => deployment.openstack_undercloud_user_password)
            keyfile = File.open("/usr/share/foreman/.ssh/id_rsa", "w", 0600)
            keyfile << client.exec!('cat /home/stack/.ssh/id_rsa')
            keyfile.close
          end

          def fix_controller_services(deployment)
            undercloud_compute = Fog::Compute::OpenStack.new(
              :openstack_auth_url => "http://#{deployment.openstack_undercloud_ip_addr}:5000/v2.0/tokens",
              :openstack_username => 'admin', :openstack_tenant => 'admin',
              :openstack_api_key => deployment.openstack_undercloud_password)

            controllers = undercloud_compute.list_servers.body["servers"].select { |hash| /^overcloud-controller/ =~ hash["name"] }

            controllers.each do |controller|
              chost_addr = undercloud_compute.list_addresses(controller["id"]).body["addresses"]["ctlplane"][0]["addr"]
              client = Net::SSH.start(chost_addr, 'heat-admin')
              client.exec!("""sudo sed -ri 's/\\[app:proxy-server\\]/\\[app:proxy-server\\]\\\nnode_timeout=60/g'"""\
                           """ /etc/swift/proxy-server.conf""")
              client.exec!("sudo systemctl restart openstack-swift-proxy")
              ["neutron-server", "neutron-l3-agent", "neutron-dhcp-agent", "neutron-openvswitch-agent"].each do |service|
                client.exec!("sudo systemctl enable #{service}")
                client.exec!("sudo systemctl start #{service}")
              end
            end
          end
        end
      end
    end
  end
end
